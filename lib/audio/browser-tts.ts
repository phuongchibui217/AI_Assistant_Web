import type { SupportedLang } from "@/lib/lang-detect";
import { chunkTextByBytes } from "../sentence-split";

const LANG_TO_BCP47: Record<SupportedLang, string> = {
  ja: "ja-JP",
  en: "en-US",
  ko: "ko-KR",
  zh: "zh-CN",
  zhTW: "zh-TW",
  ru: "ru-RU",
  vi: "vi-VN",
  id: "id-ID",
  my: "my-MM",
  ne: "ne-NP",
  th: "th-TH",
  fil: "fil-PH",
  pt: "pt-BR",
};

const MALE_VOICE_HINT = /\b(?:male|man|an)\b|david|mark|george|daniel|ichiro|keita|nam[\s-]*minh|yunjian|yunxi|injoon/i;
const FEMALE_VOICE_HINT = /female|woman|zira|samantha|victoria|haruka|nanami|ayumi|hoaimy|linh|xiaoxiao|sunhi/i;
const PAUSE_PUNCT_RE = /[,、;:.。!?—]/;
const PURE_PAUSE_PUNCT_RE = /^[\s,、;:.。!?—]+$/;
const STRONG_PAUSE_RE = /[.。!?]/;

function pickVoice(synth: SpeechSynthesis, bcp47: string, gender: "female" | "male"): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  const locale = bcp47.toLowerCase();
  const prefix = locale.split("-")[0];
  const exact = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === locale);
  const byLang = exact.length
    ? exact
    : voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === prefix);

  const hint = gender === "male" ? MALE_VOICE_HINT : FEMALE_VOICE_HINT;
  const gendered = byLang.find((v) => hint.test(v.name));
  return gendered ?? byLang[0] ?? null;
}

function waitForVoice(synth: SpeechSynthesis, bcp47: string, opts: BrowserTtsOptions): Promise<SpeechSynthesisVoice | null> {
  const readVoice = () => pickVoice(synth, bcp47, opts.gender);
  const voice = readVoice();
  if (voice || opts.signal.aborted) return Promise.resolve(voice);
  return new Promise((resolve) => {
    const finish = (match: SpeechSynthesisVoice | null) => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      opts.signal.removeEventListener("abort", onAbort);
      resolve(match);
    };
    const onVoicesChanged = () => {
      const match = readVoice();
      if (match) finish(match);
    };
    const onAbort = () => finish(null);
    const timer = window.setTimeout(() => finish(readVoice()), 1000);
    synth.addEventListener("voiceschanged", onVoicesChanged);
    opts.signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function cancelBrowserTts(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore browser quirks when no speech is active.
    }
  }
}

export type BrowserTtsOptions = {
  lang: SupportedLang;
  gender: "female" | "male";
  muted: boolean;
  signal: AbortSignal;
  onSpeakingChange?: (speaking: boolean) => void;
  /**
   * Live mouth openness (0..1) driven by `onboundary` word events and comma/
   * period pauses. Passes `null` when the browser does not emit `onboundary`
   * so MouthAnimator falls back to its estimated syllable rhythm.
   */
  onOpenness?: (openness: number | null) => void;
};

/**
 * Find normalized positions [0..1] of pause punctuation in `text` so even when
 * a browser voice does not emit `onboundary`, we can still dip the mouth closed
 * smoothly across commas and sentence breaks.
 */
function findPauseWindows(text: string, estimatedMs: number): Array<{ start: number; end: number }> {
  const len = Math.max(1, text.length);
  const windows: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!PAUSE_PUNCT_RE.test(ch)) continue;
    const frac = i / len;
    const width = (STRONG_PAUSE_RE.test(ch) ? 180 : 95) / estimatedMs;
    windows.push({ start: frac, end: Math.min(1, frac + width) });
  }
  return windows;
}

/**
 * Fallback TTS using the browser's built-in `window.speechSynthesis` when the
 * server `/api/tts/synthesize` endpoint is unavailable (e.g. local frontend
 * demo without Cloud TTS keys).
 *
 * - Uses `utterance.onboundary` when emitted by the browser/voice so mouth
 *   opening follows actual words and closes cleanly during comma/period pauses.
 * - Falls back seamlessly to an estimated syllable rhythm (with punctuation
 *   pauses) when the voice does not emit `onboundary`.
 * Returns false if the browser cannot speak the requested language.
 */
export async function speakWithBrowserTts(
  text: string,
  opts: BrowserTtsOptions,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || opts.signal.aborted) return true;
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return false;
  }
  const synth = window.speechSynthesis;
  const voice = await waitForVoice(synth, LANG_TO_BCP47[opts.lang], opts);
  if (opts.signal.aborted) return true;
  if (!voice) return false;

  try {
    // Small, sequential utterances avoid browser limits on long speech.
    for (const chunk of chunkTextByBytes(trimmed, 320)) {
      if (opts.signal.aborted) return true;
      if (!(await speakUtterance(synth, voice, chunk, opts))) return false;
    }
    return true;
  } finally {
    opts.onOpenness?.(0);
    opts.onSpeakingChange?.(false);
  }
}

function speakUtterance(
  synth: SpeechSynthesis,
  voice: SpeechSynthesisVoice,
  text: string,
  opts: BrowserTtsOptions,
): Promise<boolean> {
  const estTotalMs = Math.max(1400, text.length * 72);
  const pauseWindows = findPauseWindows(text, estTotalMs);
  return new Promise((resolve) => {
    let settled = false;
    let startedAt: number | null = null;
    let idleSince: number | null = null;
    let hasBoundary = false;
    let activeWordStartMs = 0;
    let activeWordDurationMs = 0;
    let activeWordPeak = 0.8;
    const queuedAt = performance.now();

    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(envelopeTimer);
      opts.signal.removeEventListener("abort", onAbort);
      opts.onOpenness?.(0);
      resolve(completed);
    };
    const onAbort = () => {
      finish(true);
      cancelBrowserTts();
    };

    opts.signal.addEventListener("abort", onAbort, { once: true });

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang;
    utterance.voice = voice;
    utterance.volume = opts.muted ? 0 : 1;
    utterance.rate = 1.0;
    utterance.pitch = opts.gender === "male" ? 0.92 : 1.05;

    const markStarted = () => {
      if (settled || startedAt !== null) return;
      startedAt = performance.now();
      opts.onSpeakingChange?.(true);
    };
    utterance.onstart = markStarted;

    utterance.onboundary = (ev) => {
      if (settled) return;
      markStarted();
      hasBoundary = true;
      const idx = Math.max(0, ev.charIndex ?? 0);
      let len = ev.charLength && ev.charLength > 0 ? ev.charLength : 0;
      if (!len) {
        const rest = text.slice(idx);
        const m = rest.match(/^[^\s,、;:.。!?—]+/);
        len = m ? m[0].length : 3;
      }
      const rawWord = text.slice(idx, idx + len).trim();
      activeWordStartMs = performance.now();
      // Ignore pure-punctuation boundary events; let the mouth close on pauses.
      if (!rawWord || PURE_PAUSE_PUNCT_RE.test(rawWord)) {
        activeWordDurationMs = 0;
        opts.onOpenness?.(0);
        return;
      }
      const word = rawWord.replace(/[,、;:.。!?—]+$/g, "");
      if (!word) {
        activeWordDurationMs = 0;
        opts.onOpenness?.(0);
        return;
      }
      // Scale spoken word window by character length (150ms..480ms).
      activeWordDurationMs = Math.max(150, Math.min(480, word.length * 64));
      // Vary peak openness gently per word so consecutive words look alive.
      const hash = (idx * 31 + word.length * 17) % 10;
      activeWordPeak = 0.58 + (hash / 9) * 0.34;
      // Open promptly on word onset rather than waiting for the next 35ms tick.
      opts.onOpenness?.(Math.min(0.95, activeWordPeak * 0.72));
    };

    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    // 35ms envelope driver:
    // - With `onboundary`: shapes a crisp syllable pulse for the active word,
    //   then closes smoothly to 0 during comma/period pauses until next word.
    // - Without `onboundary`: dips cleanly to 0 across estimated comma/period
    //   windows and passes `null` otherwise (estimated syllable oscillator).
    const envelopeTimer = window.setInterval(() => {
      if (settled || startedAt === null) return;
      const now = performance.now();
      if (hasBoundary) {
        const dtMs = now - activeWordStartMs;
        if (activeWordDurationMs <= 0 || dtMs > activeWordDurationMs) {
          // Some voices stop emitting boundaries mid-sentence. Briefly close
          // at the word edge, then follow the estimated rhythm if still speaking.
          opts.onOpenness?.(dtMs - activeWordDurationMs < 130 || !synth.speaking ? 0 : null);
          return;
        }
        const u = dtMs / activeWordDurationMs;
        const syllables = Math.max(1, Math.round(activeWordDurationMs / 155));
        const pulse = Math.abs(Math.sin(u * Math.PI * syllables));
        const envelope = Math.sin(u * Math.PI); // taper cleanly at word edges
        const openness = Math.min(0.95, activeWordPeak * (0.35 + 0.65 * pulse) * (0.45 + 0.55 * envelope));
        opts.onOpenness?.(openness);
      } else {
        const frac = (now - startedAt) / estTotalMs;
        const inPause = pauseWindows.some((w) => frac >= w.start && frac <= w.end);
        opts.onOpenness?.(inPause ? 0 : null);
      }
    }, 35);

    // Allow for missing end events without imposing a deadline on active speech.
    const pollTimer = window.setInterval(() => {
      if (settled) return;
      const now = performance.now();
      if (synth.speaking) {
        markStarted();
      }
      if (startedAt === null && now - queuedAt > 8000) {
        finish(false);
        cancelBrowserTts();
      } else if (synth.speaking || synth.pending || synth.paused) {
        idleSince = null;
      } else if (startedAt !== null) {
        idleSince ??= now;
        if (now - idleSince >= 240) finish(true);
      }
    }, 60);

    try {
      synth.speak(utterance);
    } catch {
      finish(false);
    }
  });
}
