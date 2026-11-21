/**
 * Browser STT client. Records the whole microphone utterance with
 * `MediaRecorder` (webm/opus) and, on stop, POSTs the clip to `/api/stt`,
 * which runs Google Cloud Speech-to-Text v2 (Chirp) with automatic language
 * detection and returns the transcript.
 *
 * Why record-then-POST instead of streaming: the mic is push-to-talk (short
 * utterances), and Google's language auto-detection only works in sync
 * recognition, not streaming. Sending the full clip in one sync request lets
 * Chirp detect the spoken language across every supported language, so the mic
 * is no longer locked to the UI language. The trade-off is no live interim
 * transcript and a ~1-2s recognise step after release - fine for push-to-talk.
 *
 * Lifecycle: caller creates one `SttClient` per mic press. `start()` opens the
 * mic + recorder; `stop()` finalises the recording, POSTs it, then fires
 * `onFinal(transcript)` followed by `onEnded`.
 */

/**
 * Where an STT error came from. Callers must not sniff the message text to
 * decide: a backend failure can itself contain the word "permission" (Google
 * returns `PERMISSION_DENIED` when the Speech-to-Text API is disabled on the
 * project), which used to be rendered as "microphone access denied - check your
 * browser settings" and sent people to fix the wrong thing.
 *   "mic" - getUserMedia was rejected; the browser refused the microphone.
 *   "stt" - recorder / transport / recognition backend failed.
 */
export type SttErrorKind = "mic" | "stt";

export type SttCallbacks = {
  /** Fired once with the full transcript + Chirp's detected BCP-47 language
   *  (e.g. "th-TH", "") after recognition completes. */
  onFinal?: (text: string, lang: string) => void;
  onError?: (message: string, kind: SttErrorKind) => void;
  /** Fired after recognition finishes (success or failure) and teardown is done. */
  onEnded?: () => void;
  /** Fired if the safety cap stops the mic before the user released, so the UI
   *  can drop out of "listening" before recognition returns. */
  onAutoStop?: () => void;
};

// The mic is push-to-talk: the user holds the button (or Space) and releases to
// stop, so there is no silence detection. An energy VAD used to auto-stop after
// a couple of seconds of quiet, which fought the user the moment they paused to
// think mid-hold (the "mic releases itself" complaint). Only a hard cap remains,
// as a safety net against a stuck pointer leaving the mic open forever.
//
// Deliberately shorter than the streaming engine's cap: this path posts the whole
// clip to Google's SYNCHRONOUS recognize, which rejects audio past roughly a
// minute, so a longer hold would record fine and then fail at the very end.
// Anything needing longer has to move to the streaming path.
const MAX_RECORD_MS = 45_000;

export class SttClient {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mime = "";
  private callbacks: SttCallbacks;
  private started = false;
  private stopping = false;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: SttCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.started = false;
      const msg = err instanceof Error ? err.message : "mic permission denied";
      this.callbacks.onError?.(msg, "mic");
      throw err;
    }

    const mime = pickMime();
    if (!mime) {
      this.cleanupStream();
      this.started = false;
      this.callbacks.onError?.("MediaRecorder audio capture not supported", "stt");
      throw new Error("no supported recorder mime");
    }
    this.mime = mime;

    const recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      const msg =
        ("error" in e && (e as ErrorEvent).error?.message) || "MediaRecorder error";
      this.callbacks.onError?.(String(msg), "stt");
    };
    // No timeslice: the recorder emits one blob when we stop(), which is all we
    // need - the whole clip goes to the server in a single request.
    recorder.start();
    this.startMaxDurationTimer();
  }

  /** Hard safety cap only - see MAX_RECORD_MS. Release stops the mic normally. */
  private startMaxDurationTimer(): void {
    this.maxDurationTimer = setTimeout(() => this.autoStop(), MAX_RECORD_MS);
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private autoStop(): void {
    if (this.stopping) return;
    this.clearMaxDurationTimer();
    this.callbacks.onAutoStop?.();
    this.stop();
  }

  stop(): void {
    if (!this.started || this.stopping) return;
    this.stopping = true;
    this.clearMaxDurationTimer();

    const recorder = this.recorder;
    if (!recorder) {
      this.finish();
      return;
    }
    // When the recorder stops it flushes its final blob (ondataavailable) and
    // then fires onstop; transcribe from there so we have all the audio.
    recorder.onstop = () => {
      void this.transcribeAndFinish();
    };
    try {
      recorder.stop();
    } catch {
      void this.transcribeAndFinish();
    }
    // Release the mic immediately so the browser's recording indicator clears
    // while recognition runs.
    this.cleanupStream();
  }

  private async transcribeAndFinish(): Promise<void> {
    const blob = new Blob(this.chunks, { type: this.mime });
    this.chunks = [];
    try {
      if (blob.size > 0) {
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: { "content-type": this.mime },
          body: blob,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`stt ${res.status}: ${detail.slice(0, 200)}`);
        }
        const json = (await res.json()) as { text?: string; lang?: string };
        const text = (json.text ?? "").trim();
        const lang = (json.lang ?? "").trim();
        if (text) this.callbacks.onFinal?.(text, lang);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stt request failed";
      this.callbacks.onError?.(msg, "stt");
    } finally {
      this.finish();
    }
  }

  /** Reset internal state and notify the caller the session is over. */
  private finish(): void {
    this.clearMaxDurationTimer();
    this.recorder = null;
    this.cleanupStream();
    this.started = false;
    this.stopping = false;
    this.callbacks.onEnded?.();
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    // Desktop Chrome/Edge/Firefox: Opus in WebM/Ogg.
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    // iOS/iPadOS Safari supports NEITHER webm nor ogg for MediaRecorder - it
    // records AAC in an MP4 container. Google STT v2 autoDecodingConfig
    // auto-detects MP4_AAC, so this works end to end. Without these, iOS threw
    // "MediaRecorder ... not supported" and voice input was dead on iPad.
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
