/**
 * @deprecated DEAD CODE 2026-05-28 - migrated voice stack off Gemini Live
 * (preview model: silent truncation, voice tone drift, "stops working after
 * idle" cluster). The stable stack uses Web Speech API for STT + Cloud TTS
 * Neural2 for output; see `hooks/use-gemini-session.ts` (rewritten) and
 * `lib/speech-recogniser.ts`. This module + the matching server proxy
 * (`server.js` /ws route) are kept here so we can rollback quickly if
 * Vertex AI ships a stable native-audio model worth coming back for. Grep
 * `@deprecated DEAD CODE 2026-05-28` to find the rollback set.
 */
import {
  base64ToBytes,
  bytesToBase64,
} from "@/lib/audio-convert";
import type {
  ClientSetupMessage,
  ServerMessage,
} from "@/lib/gemini-messages";

const isDev = process.env.NODE_ENV !== "production";

type SessionCallbacks = {
  onSessionReady?: () => void;
  onUserTranscript?: (text: string, lang: string) => void;
  onOutputTranscript?: (text: string) => void;
  onAudioChunk?: (pcm: Uint8Array) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
  onSessionClosed?: (reason: string) => void;
  /**
   * Fired when the server signals a graceful end-of-session (`goAway`) or when
   * the 14-min idle safety net trips. The hook reacts by reconnecting through
   * the stored resumption handle without surfacing an error to the user.
   */
  onSoftReconnect?: (reason: "goAway" | "idleSafety" | "ageLimit") => void;
};

/**
 * Soft reconnect ~500 ms before the server actually closes the socket on
 * `goAway`. Anything tighter risks the close arriving first; anything looser
 * wastes the remaining session window.
 */
const GO_AWAY_RECONNECT_GRACE_MS = 500;

/**
 * Hard idle ceiling. Live currently caps a session at ~15 min; we tear down
 * one minute early so the reconnect lands cleanly even if `goAway` was lost
 * (it does happen on flaky networks). Reset every time we hear from the
 * server.
 */
const IDLE_SAFETY_TIMEOUT_MS = 14 * 60 * 1000;

/**
 * Active-session age limit (2026-05-28 feedback "càng kéo session càng dễ
 * lỗi"). Live native-audio's output quality degrades as cumulative audio
 * output in a session climbs - turns get truncated, chunks arrive irregularly
 * (clicks), and eventually the model just refuses to finish reads. The idle
 * timer above only fires when nothing happens for 14 min, which is useless
 * for an active demo: the user keeps talking, the timer keeps resetting, and
 * the session ages until it falls apart.
 *
 * We check this on every server-side turnComplete (a natural splice point)
 * and trigger a soft reconnect when exceeded. Threshold is conservative -
 * Live's own 15 min cap is the upper bound; we want to rotate well before
 * the symptoms appear, which start somewhere around 5-7 min of cumulative
 * use in practice.
 */
const ACTIVE_SESSION_MAX_MS = 6 * 60 * 1000;

/**
 * Parse a subset of ISO-8601 durations the Live `goAway` message uses, e.g.
 * "PT5S" / "PT1M30S" / "PT0.5S". Returns 0 on anything we can't read so we
 * fall back to "reconnect immediately" rather than waiting forever.
 */
function parseIsoDurationMs(iso: string): number {
  const m = /^PT(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return 0;
  const min = m[1] ? parseFloat(m[1]) : 0;
  const sec = m[2] ? parseFloat(m[2]) : 0;
  return Math.round((min * 60 + sec) * 1000);
}

/**
 * Manages a bidirectional WebSocket session with the Gemini Live API.
 *
 * The session connects to our own server-side proxy (`/ws`), not directly to
 * Google. The proxy keeps the API key off the client.
 *
 * Lifecycle:
 *   1. `connect()` opens the socket and sends the `setup` frame.
 *   2. Server replies with `setupComplete` -> `onSessionReady` fires.
 *   3. Client streams `realtimeInput` audio chunks (or `clientContent` text).
 *   4. Server streams `serverContent` with audio + transcripts.
 *   5. `disconnect()` closes the socket.
 */
export class GeminiLiveSession {
  private readonly wsUrl: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly callbacks: SessionCallbacks;

  private socket: WebSocket | null = null;
  private setupComplete = false;
  /** Timestamp set when setup completes; used by the active-session age
   *  limit so we can rotate the socket at the next turn boundary before
   *  Live's output starts degrading. 0 until the first setupComplete. */
  private sessionReadyAt = 0;

  /** Optional system instruction injected into the setup frame. */
  private readonly systemInstruction: string | undefined;

  /**
   * Latest resumption handle from the server's periodic
   * `sessionResumptionUpdate` frames. Sent on the NEXT setup to continue the
   * same conversation across reconnects. Survives `disconnect()` so a graceful
   * reconnect path can read it back; only cleared on explicit `resetResumption()`.
   */
  private resumptionHandle: string | null = null;
  private goAwayTimer: ReturnType<typeof setTimeout> | null = null;
  private idleSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True between the moment we schedule a soft reconnect and the moment the
   * subsequent close event lands. Suppresses the normal `onSessionClosed`
   * reconnect path so we don't fire two reconnects for one goAway.
   */
  private softReconnectPending = false;

  constructor(
    wsUrl: string,
    model: string,
    voice: string,
    callbacks: SessionCallbacks = {},
    systemInstruction?: string,
  ) {
    this.wsUrl = wsUrl;
    this.model = model;
    this.voice = voice;
    this.callbacks = callbacks;
    this.systemInstruction = systemInstruction;
  }

  get isReady(): boolean {
    return this.setupComplete && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setupComplete = false;
      this.socket = new WebSocket(this.wsUrl);

      this.socket.onopen = () => {
        if (isDev) console.log("[GeminiLive] socket open");
        this.softReconnectPending = false;
        this.sendSetup();
        this.resetIdleSafetyTimer();
        resolve();
      };

      this.socket.onmessage = (ev) => {
        void this.handleMessage(ev).catch((err) =>
          console.error("[GeminiLive] handleMessage error:", err),
        );
      };

      this.socket.onerror = (ev) => {
        const reason = (ev as ErrorEvent).message ?? "WebSocket error";
        console.error("[GeminiLive] socket error:", reason);
        this.callbacks.onSessionClosed?.(reason);
        reject(new Error(reason));
      };

      this.socket.onclose = (ev) => {
        if (isDev) {
          console.log(
            `[GeminiLive] socket close - code=${ev.code} reason="${ev.reason}"`,
          );
        }
        this.setupComplete = false;
        this.clearGoAwayTimer();
        this.clearIdleSafetyTimer();
        // If a soft reconnect is already in flight, swallow the close so the
        // hook doesn't fire the error-path reconnect on top of the graceful
        // one. The hook drives the reconnect from onSoftReconnect.
        if (this.softReconnectPending) {
          this.softReconnectPending = false;
          return;
        }
        this.callbacks.onSessionClosed?.(ev.reason || String(ev.code));
      };
    });
  }

  disconnect(): void {
    this.clearGoAwayTimer();
    this.clearIdleSafetyTimer();
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.setupComplete = false;
    this.sessionReadyAt = 0;
    this.socket = null;
  }

  /**
   * Drop the resumption handle. Call this when starting a fresh conversation
   * (e.g. user reload / explicit "new chat") so the next setup does not try
   * to continue a stale session.
   */
  resetResumption(): void {
    this.resumptionHandle = null;
  }

  /** Internal: the handle (if any) to embed in the next setup. */
  getResumptionHandle(): string | null {
    return this.resumptionHandle;
  }

  private clearGoAwayTimer(): void {
    if (this.goAwayTimer) {
      clearTimeout(this.goAwayTimer);
      this.goAwayTimer = null;
    }
  }

  private clearIdleSafetyTimer(): void {
    if (this.idleSafetyTimer) {
      clearTimeout(this.idleSafetyTimer);
      this.idleSafetyTimer = null;
    }
  }

  private resetIdleSafetyTimer(): void {
    this.clearIdleSafetyTimer();
    this.idleSafetyTimer = setTimeout(() => {
      this.idleSafetyTimer = null;
      if (!this.isReady) return;
      if (isDev) console.warn("[GeminiLive] idle safety timer fired");
      this.softReconnectPending = true;
      this.callbacks.onSoftReconnect?.("idleSafety");
    }, IDLE_SAFETY_TIMEOUT_MS);
  }

  /**
   * Send a 16 kHz mono PCM16 chunk. JSON is assembled by string concat to
   * avoid object allocation overhead - this is called ~10 times per second
   * during voice input.
   */
  sendAudioChunk(pcm: Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const b64 = bytesToBase64(pcm);
    const json = `{"realtimeInput":{"audio":{"mimeType":"audio/pcm;rate=16000","data":"${b64}"}}}`;
    this.socket.send(json);
  }

  /**
   * Signal end of user's audio turn. Server VAD would detect this on its own
   * after a silence interval; the explicit signal cuts that interval.
   */
  sendAudioStreamEnd(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send('{"realtimeInput":{"audioStreamEnd":true}}');
  }

  /** Send a text user turn. Server still replies with AUDIO + transcript. */
  sendText(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const msg = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    };
    this.socket.send(JSON.stringify(msg));
  }

  private buildSetupMessage(): ClientSetupMessage {
    const setup: ClientSetupMessage["setup"] = {
      model: `models/${this.model}`,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.voice },
          },
        },
        // Default Live cap is ~1024 - long answers (stories, multi-step
        // explanations) get cut mid-sentence. Match Unity's Inspector value.
        maxOutputTokens: 8192,
      },
    };
    if (this.systemInstruction) {
      setup.systemInstruction = {
        parts: [{ text: this.systemInstruction }],
      };
    }
    // Always opt in to session resumption so the server emits
    // `sessionResumptionUpdate` frames. Carry the stored handle (if any) so a
    // graceful reconnect continues the same conversation instead of starting
    // a fresh one.
    setup.sessionResumption = this.resumptionHandle
      ? { handle: this.resumptionHandle }
      : {};
    return { setup };
  }

  private sendSetup(): void {
    const msg = this.buildSetupMessage();
    this.socket?.send(JSON.stringify(msg));
  }

  /**
   * Browser `WebSocket.onmessage` data is a Blob (unlike Node which gives
   * Buffer). Decode to string before parsing JSON.
   *
   * One `serverContent` frame can carry multiple fields simultaneously
   * (e.g. modelTurn + outputTranscription + turnComplete) - dispatch all of
   * them, do not early-return.
   */
  private async handleMessage(ev: MessageEvent): Promise<void> {
    let raw: string;
    if (ev.data instanceof Blob) {
      const buf = await ev.data.arrayBuffer();
      raw = new TextDecoder().decode(buf);
    } else if (typeof ev.data === "string") {
      raw = ev.data;
    } else {
      return;
    }

    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch (err) {
      console.error("[GeminiLive] JSON parse error:", err);
      return;
    }

    // Any frame from the server is a sign the session is alive - bump the
    // idle safety timer so we don't reconnect on a healthy long-running turn.
    this.resetIdleSafetyTimer();

    if (msg.setupComplete !== undefined) {
      this.setupComplete = true;
      this.sessionReadyAt = Date.now();
      this.callbacks.onSessionReady?.();
      return;
    }

    if (msg.sessionResumptionUpdate?.newHandle) {
      // Passive heartbeat from the server: it periodically rotates the handle
      // we would need to resume on reconnect. NOT a reconnect itself; the
      // socket and player state are untouched. Log silenced to stop people
      // (myself included) reading it as a reconnect event.
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }

    const sc = msg.serverContent;
    if (sc) {
      if (sc.inputTranscription) {
        this.callbacks.onUserTranscript?.(sc.inputTranscription.text, "");
      }
      if (sc.outputTranscription) {
        this.callbacks.onOutputTranscript?.(sc.outputTranscription.text);
      }
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            const pcm = base64ToBytes(part.inlineData.data);
            this.callbacks.onAudioChunk?.(pcm);
          }
        }
      }
      if (sc.turnComplete === true) {
        this.callbacks.onTurnComplete?.();
        // Active-session age check fires here (a turn boundary is the only
        // safe splice point - mid-turn rotation would cut audio). Trigger
        // soft reconnect once we cross the threshold so the NEXT turn runs
        // on a fresh socket while Live's still healthy.
        if (
          this.sessionReadyAt > 0 &&
          !this.softReconnectPending &&
          Date.now() - this.sessionReadyAt > ACTIVE_SESSION_MAX_MS
        ) {
          if (isDev) console.log("[GeminiLive] active session age limit hit");
          this.softReconnectPending = true;
          this.callbacks.onSoftReconnect?.("ageLimit");
        }
      }
      if (sc.interrupted === true) {
        this.callbacks.onInterrupted?.();
      }
    }

    if (msg.goAway) {
      if (isDev) {
        console.warn("[GeminiLive] goAway, timeLeft:", msg.goAway.timeLeft);
      }
      this.scheduleGoAwayReconnect(msg.goAway.timeLeft);
    }
  }

  /**
   * Server says "I'm about to close" - fire the soft-reconnect callback so the
   * hook can spin up a fresh socket with the stored resumption handle. We aim
   * to land the new connect ~500 ms before the server's `timeLeft` expires.
   */
  private scheduleGoAwayReconnect(timeLeftIso: string): void {
    if (this.softReconnectPending) return;
    this.softReconnectPending = true;
    this.clearGoAwayTimer();
    const leftMs = parseIsoDurationMs(timeLeftIso);
    const delay = Math.max(0, leftMs - GO_AWAY_RECONNECT_GRACE_MS);
    this.goAwayTimer = setTimeout(() => {
      this.goAwayTimer = null;
      this.callbacks.onSoftReconnect?.("goAway");
    }, delay);
  }
}
