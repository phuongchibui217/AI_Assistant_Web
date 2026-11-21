/**
 * Streaming STT client (案1). Captures the mic as 16 kHz mono PCM16 and streams
 * it over a WebSocket to the `/ws/stt-v2` bridge (Google Cloud STT v2 `long`
 * model), which returns live interim transcripts so the text can appear in the
 * input box as the user speaks. Used only for the languages the `long` model
 * detects (ja/en/vi); every other language falls back to the record-then-POST
 * `SttClient` (no interim).
 *
 * Protocol (see lib/server/cloud-stt-stream.js):
 *   send  {type:"start"}  -> binary PCM frames -> {type:"stop"}
 *   recv  {type:"ready"} / {type:"transcript",text,isFinal,lang} /
 *         {type:"error",message} / {type:"ended"}
 *
 * Lifecycle: one `SttStreamer` per mic press. `start()` opens the mic + socket;
 * `stop()` half-closes the stream; the server flushes the final result and
 * fires `onEnded`. The mic is push-to-talk, so it runs until the user releases
 * (a hard duration cap is the only automatic stop).
 */

import { downsample, floatToPcm16 } from "@/lib/audio-convert";
import { joinTranscript } from "@/lib/audio/join-transcript";
import type { SttErrorKind } from "@/lib/audio/stt-client";

export type SttStreamCallbacks = {
  /** Live display update while speaking: committed finals + current interim. */
  onPartial?: (text: string, lang: string) => void;
  /** Fired once when the utterance is committed (stream ended). */
  onFinal?: (text: string, lang: string) => void;
  onError?: (message: string, kind: SttErrorKind) => void;
  /** Fired after the stream closes and teardown is done. */
  onEnded?: () => void;
  /** Fired if the safety cap stops the mic before the user released. */
  onAutoStop?: () => void;
};

const TARGET_RATE = 16000;
const CHUNK_MS = 100;
const CHUNK_SAMPLES = (TARGET_RATE * CHUNK_MS) / 1000;

// Push-to-talk: the user holds to talk and releases to stop, so there is no
// silence detection (it used to cut people off mid-hold when they paused).
// Only a hard safety cap remains, sized for someone composing a long question
// out loud with thinking pauses - the old 20s cut them off mid-sentence.
// Streaming recognition tolerates minutes of audio, so this sits well inside the
// service limit and exists purely to stop a stuck pointer holding the mic open.
const MAX_RECORD_MS = 90_000;

export class SttStreamer {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly callbacks: SttStreamCallbacks;
  /** BCP-47 code for the picked mic language (e.g. "ja-JP"); sent to the bridge
   *  so the `long` model streams that single language. Empty = bridge default. */
  private readonly langCode: string;
  private started = false;
  private stopping = false;
  private ready = false;
  /** Audio captured before the server said "ready" - flushed once it does so
   *  the opening words are not lost while the socket handshakes. */
  private preReadyQueue: Uint8Array[] = [];
  private accumulator = new Float32Array(0);

  /** Committed final text so far (interim is appended live for display). */
  private finalText = "";
  private lang = "";

  constructor(callbacks: SttStreamCallbacks = {}, langCode = "") {
    this.callbacks = callbacks;
    this.langCode = langCode;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      this.started = false;
      const msg = err instanceof Error ? err.message : "mic permission denied";
      this.callbacks.onError?.(msg, "mic");
      throw err;
    }

    this.openSocket();
    this.startCapture();
    this.startMaxDurationTimer();
  }

  private openSocket(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/stt-v2`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", lang: this.langCode || undefined }));
    };
    ws.onmessage = (ev) => {
      let msg: {
        type?: string;
        text?: string;
        isFinal?: boolean;
        lang?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg.type === "ready") {
        this.ready = true;
        this.flushPreReady();
      } else if (msg.type === "transcript") {
        this.onTranscript(msg.text ?? "", !!msg.isFinal, msg.lang ?? "");
      } else if (msg.type === "error") {
        this.callbacks.onError?.(msg.message ?? "stt stream error", "stt");
        this.finish();
      } else if (msg.type === "ended") {
        this.commitFinal();
        this.finish();
      }
    };
    ws.onerror = () => {
      // The close handler runs teardown; surface a generic message once.
      if (!this.stopping)
        this.callbacks.onError?.("stt stream connection error", "stt");
    };
    ws.onclose = () => {
      // A close without a prior "ended" still needs to finalise + notify.
      this.finish();
    };
  }

  private onTranscript(text: string, isFinal: boolean, lang: string): void {
    if (lang && !this.lang) this.lang = lang;
    const clean = text.trim();
    if (isFinal) {
      this.finalText = joinTranscript(this.finalText, clean);
      this.callbacks.onPartial?.(this.finalText, this.lang);
    } else {
      const display = clean ? joinTranscript(this.finalText, clean) : this.finalText;
      this.callbacks.onPartial?.(display, this.lang);
    }
  }

  private commitFinal(): void {
    const text = this.finalText.trim();
    if (text) this.callbacks.onFinal?.(text, this.lang);
  }

  // ── Audio capture ──────────────────────────────────────────────────────────
  private startCapture(): void {
    if (!this.stream) return;
    const nativeRate =
      this.stream.getAudioTracks()[0].getSettings().sampleRate ?? 48000;
    const ctx = new AudioContext({ sampleRate: nativeRate });
    this.audioCtx = ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.processor = ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => this.onAudio(ev, nativeRate);
    this.source.connect(this.processor);
    // Connecting to destination is required for onaudioprocess to fire; we do
    // NOT route mic to speakers (the processor output is silent).
    this.processor.connect(ctx.destination);
  }

  private onAudio(ev: AudioProcessingEvent, nativeRate: number): void {
    if (this.stopping) return;
    const raw = ev.inputBuffer.getChannelData(0);
    const resampled = downsample(raw, nativeRate, TARGET_RATE);
    const combined = new Float32Array(this.accumulator.length + resampled.length);
    combined.set(this.accumulator);
    combined.set(resampled, this.accumulator.length);
    this.accumulator = combined;

    while (this.accumulator.length >= CHUNK_SAMPLES) {
      const slice = this.accumulator.slice(0, CHUNK_SAMPLES);
      this.sendPcm(floatToPcm16(slice));
      this.accumulator = this.accumulator.slice(CHUNK_SAMPLES);
    }
  }

  private sendPcm(pcm: Uint8Array): void {
    if (!this.ready) {
      this.preReadyQueue.push(pcm);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  private flushPreReady(): void {
    for (const pcm of this.preReadyQueue) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
    }
    this.preReadyQueue = [];
  }

  /** Hard safety cap only - see MAX_RECORD_MS. Release stops the mic normally. */
  private startMaxDurationTimer(): void {
    this.maxDurationTimer = setTimeout(() => this.autoStop(), MAX_RECORD_MS);
  }

  private autoStop(): void {
    if (this.stopping) return;
    this.callbacks.onAutoStop?.();
    this.stop();
  }

  /** Half-close the stream: stop capturing + tell the server to flush. The
   *  server's final transcript + "ended" arrive after this, then onEnded. */
  stop(): void {
    if (!this.started || this.stopping) return;
    this.stopping = true;
    this.teardownAudio();
    // Flush any tail samples before signalling stop.
    if (this.accumulator.length > 0) {
      this.sendPcm(floatToPcm16(this.accumulator));
      this.accumulator = new Float32Array(0);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop" }));
    } else {
      // Socket never opened; finalise immediately.
      this.finish();
    }
  }

  private teardownAudio(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private finished = false;
  /** Idempotent teardown + notify. Runs on ended / error / close. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.teardownAudio();
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
    this.started = false;
    this.stopping = false;
    this.callbacks.onEnded?.();
  }
}
