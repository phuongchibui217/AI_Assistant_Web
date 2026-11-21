/**
 * @deprecated DEAD CODE 2026-05-29 PM. Superseded by the Cloud STT WS
 * pipeline in `lib/audio/stt-client.ts` + `lib/server/cloud-stt-bridge.js`.
 * Web Speech API only worked on Chrome/Edge desktop and was prone to
 * silent zombie state on flaky networks. Kept temporarily for rollback
 * before final delete - safe to remove once the customer has signed off
 * on the Cloud STT migration.
 *
 * Thin wrapper around the browser's Web Speech API (`SpeechRecognition`).
 * Replaces the previous Gemini Live mic-streaming path on the stable stack:
 * Live's built-in STT meant we couldn't use the mic without an open Live
 * socket, which inherited every Live preview-model bug. The browser API is
 * free, on-device-ish, and ships with Chrome / Edge - the only two browsers
 * the demo targets.
 *
 * Lifecycle:
 *   const rec = new SpeechRecogniser({
 *     lang: "ja-JP",
 *     onFinal: (text) => console.log("user said:", text),
 *     onInterim: (text) => console.log("partial:", text),
 *     onError: (err) => console.error(err),
 *   });
 *   rec.start();   // requests mic permission on first call
 *   rec.stop();    // user released the mic button - emit final + halt
 *
 * Browser support: Chrome / Edge / Opera / Safari (modern). NOT Firefox.
 * Languages supported by Chrome/Edge include ja-JP, en-US, ko-KR, zh-CN,
 * ru-RU, vi-VN, id-ID. Burmese (my-MM) and Nepali (ne-NP) have spotty
 * support - caller can fall back to typing in those locales.
 */

export type SpeechRecogniserOpts = {
  /** BCP-47 tag, e.g. "ja-JP". Defaults to the document's lang or "ja-JP". */
  lang?: string;
  /** Fires when the user finishes a phrase and the engine commits. */
  onFinal?: (text: string) => void;
  /** Fires repeatedly while the user speaks with the current best guess. */
  onInterim?: (text: string) => void;
  /** Fires on engine error (`no-speech`, `aborted`, `audio-capture`, ...). */
  onError?: (error: string) => void;
  /** Fires once the engine stops listening (user release or auto-stop). */
  onEnd?: () => void;
};

// The Web Speech API isn't part of the standard DOM lib yet - declare just
// the slice we use so we don't pull in `@types/dom-speech-recognition`.
type SpeechRecognitionAlt = {
  prefixed?: boolean;
};

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
    length: number;
  }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown) | null;
  onerror:
    | ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => unknown)
    | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Quick capability check. Components can hide the mic button if this
 * returns false (e.g. Firefox).
 */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export class SpeechRecogniser {
  private recognition: SpeechRecognitionLike | null = null;
  private readonly opts: SpeechRecogniserOpts;
  /** True from `.start()` to `onend`; lets `.stop()` distinguish a real
   *  user release from a no-op call. */
  private running = false;
  /** Set by `.abort()` so the engine's `onend` (which still fires on the
   *  next tick) is silently swallowed - the hook's onEnd handler submits
   *  whatever the user said, and we don't want a teardown abort to push
   *  a partial transcript through React state after unmount. */
  private suppressEnd = false;

  constructor(opts: SpeechRecogniserOpts = {}) {
    this.opts = opts;
  }

  /**
   * Start listening. Idempotent if already running. Calls onError if the
   * browser doesn't support the API.
   */
  start(): void {
    if (this.running) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.opts.onError?.("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = this.opts.lang ?? document?.documentElement?.lang ?? "ja-JP";
    // Push-to-talk style: the caller calls .stop() when the user releases
    // the mic button. We still want interim results so the chat bubble can
    // show what the user is saying while they say it.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) this.opts.onFinal?.(final);
      else if (interim) this.opts.onInterim?.(interim);
    };

    rec.onerror = (event) => {
      // "no-speech" / "aborted" are normal end-of-utterance - swallow.
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.opts.onError?.(event.error || "unknown");
    };

    rec.onend = () => {
      this.running = false;
      this.recognition = null;
      if (this.suppressEnd) {
        this.suppressEnd = false;
        return;
      }
      this.opts.onEnd?.();
    };

    try {
      rec.start();
      this.recognition = rec;
      this.running = true;
    } catch (err) {
      // `InvalidStateError` if called twice in a row before onend; treat
      // as "already running" rather than a real error.
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.onError?.(msg);
    }
  }

  /** End the current recognition session. Emits any pending final result. */
  stop(): void {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      // already stopped; onend will still fire
    }
  }

  /** Abort without emitting pending result. Used on teardown - suppresses
   *  the engine's onend so the hook's onEnd handler doesn't push a stray
   *  transcript through React state after the component is gone. */
  abort(): void {
    if (!this.recognition) return;
    this.suppressEnd = true;
    try {
      this.recognition.abort();
    } catch {
      // already stopped
    }
    this.running = false;
    this.recognition = null;
  }

  isRunning(): boolean {
    return this.running;
  }
}

// Workaround for TS lib-check: pretend we used the type so it doesn't get
// tree-shaken when downstream code imports from this module.
export type _SpeechRecognitionAlt = SpeechRecognitionAlt;
