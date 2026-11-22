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
const PURE_PAUSE_PUNCT_RE = /^[\s,、，;；:：.。!?！？—]+$/;
const WORD_RE = /^[^\s,、，;；:：.。!?！？—]+/;
const END_PUNCT_RE = /[,、，;；:：.。!?！？—]+$/;
const FOLLOWING_PAUSE_RE = /^\s*[,、，;；:：.。!?！？—]/;
const BROWSER_TTS_CHUNK_BYTES = 220;

function matchingVoices(synth: SpeechSynthesis, bcp47: string, gender: "female" | "male"): SpeechSynthesisVoice[] {
  const locale = bcp47.toLowerCase();
  const prefix = locale.split("-")[0];
  const hint = gender === "male" ? MALE_VOICE_HINT : FEMALE_VOICE_HINT;
  const voiceLocale = (voice: SpeechSynthesisVoice) => voice.lang.replace(/_/g, "-").toLowerCase();
  const score = (voice: SpeechSynthesisVoice) =>
    Number(voiceLocale(voice) === locale) * 4 + Number(hint.test(voice.name)) * 2 + Number(voice.localService === true);
  return synth.getVoices()
    .filter((voice) => voiceLocale(voice).split("-")[0] === prefix)
    .sort((a, b) => score(b) - score(a));
}

function waitForVoices(synth: SpeechSynthesis, bcp47: string, opts: BrowserTtsOptions): Promise<SpeechSynthesisVoice[]> {
  const readVoices = () => matchingVoices(synth, bcp47, opts.gender);
  const voices = readVoices();
  if (voices.length || opts.signal.aborted) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const finish = (matches: SpeechSynthesisVoice[]) => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      opts.signal.removeEventListener("abort", onAbort);
      resolve(matches);
    };
    const onVoicesChanged = () => {
      const matches = readVoices();
      if (matches.length) finish(matches);
    };
    const onAbort = () => finish([]);
    const timer = window.setTimeout(() => finish(readVoices()), 1800);
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
  onFailure?: (reason: "voice-missing" | "playback") => void;
  onSpeakingChange?: (speaking: boolean) => void;
  /**
   * Live mouth openness (0..1) driven by `onboundary` word events and comma/
   * period pauses. Passes `null` when the browser does not emit `onboundary`
   * so MouthAnimator falls back to its estimated syllable rhythm.
   */
  onOpenness?: (openness: number | null) => void;
};

/**
 * Fallback TTS using the browser's built-in `window.speechSynthesis` when the
 * server `/api/tts/synthesize` endpoint is unavailable (e.g. local frontend
 * demo without Cloud TTS keys).
 *
 * - Uses `utterance.onboundary` when emitted by the browser/voice so mouth
 *   opening follows actual words and closes cleanly during comma/period pauses.
 * - Uses a light syllable rhythm while the voice is active if it does not emit
 *   boundaries consistently.
 * Returns false if the browser cannot speak the requested language.
 */
export async function speakWithBrowserTts(
  text: string,
  opts: BrowserTtsOptions,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || opts.signal.aborted) return true;
  const noVoice = () => {
    opts.onFailure?.("voice-missing");
    return false;
  };
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return noVoice();
  }
  const synth = window.speechSynthesis;
  const voices = await waitForVoices(synth, LANG_TO_BCP47[opts.lang], opts);
  if (opts.signal.aborted) return true;
  if (!voices.length) return noVoice();

  // Keep browser utterances short, and wait for each to finish before queuing
  // the next one. A long reply has no overall speaking deadline.
  let voiceIndex = 0;
  for (const chunk of chunkTextByBytes(trimmed, BROWSER_TTS_CHUNK_BYTES)) {
    if (opts.signal.aborted) return true;
    while (voiceIndex < voices.length) {
      const result = await speakUtterance(synth, voices[voiceIndex], chunk, opts);
      if (opts.signal.aborted) return true;
      if (result === "completed") break;
      if (result === "interrupted") {
        opts.onFailure?.("playback");
        return false;
      }
      // A voice that failed before making any sound can be replaced safely.
      voiceIndex++;
    }
    if (voiceIndex === voices.length) {
      opts.onFailure?.("playback");
      return false;
    }
  }
  return true;
}

function speakUtterance(
  synth: SpeechSynthesis,
  voice: SpeechSynthesisVoice,
  text: string,
  opts: BrowserTtsOptions,
): Promise<"completed" | "unstarted" | "interrupted"> {
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let mouthActive = false;
    let idleSince: number | null = null;
    let activeWordStartMs = 0;
    let activeWordDurationMs = 0;
    let activeWordPeak = 0.8;
    let activeSyllables = 1;
    let closingWord = false;
    let mouthFinished = false;
    const queuedAt = performance.now();
    const spokenEnd = text.replace(/[\s\p{P}]+$/u, "").length;
    const words = typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(LANG_TO_BCP47[opts.lang], { granularity: "word" }).segment(text)
      : null;

    const stopMouth = () => {
      if (!mouthActive) return;
      mouthActive = false;
      activeWordDurationMs = 0;
      closingWord = false;
      opts.onOpenness?.(0);
      opts.onSpeakingChange?.(false);
    };

    const finishMouth = () => {
      mouthFinished = true;
      stopMouth();
    };

    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(envelopeTimer);
      opts.signal.removeEventListener("abort", onAbort);
      stopMouth();
      resolve(completed ? "completed" : started ? "interrupted" : "unstarted");
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
      if (settled || mouthActive || mouthFinished) return;
      started = true;
      mouthActive = true;
      opts.onSpeakingChange?.(true);
      opts.onOpenness?.(null);
    };
    utterance.onstart = markStarted;
    utterance.onpause = stopMouth;
    utterance.onresume = markStarted;

    utterance.onboundary = (ev) => {
      if (settled || synth.paused || mouthFinished) return;
      markStarted();
      const idx = Math.max(0, ev.charIndex ?? 0);
      if (idx >= spokenEnd) {
        finishMouth();
        return;
      }
      // Some engines emit a sentence boundary with the whole sentence's length.
      if (ev.name === "sentence") return;
      const segment = words?.containing(idx);
      const len = ev.charLength || (segment ? segment.index + segment.segment.length - idx : 0);
      const wordLength = len || text.slice(idx).match(WORD_RE)?.[0].length || 3;
      const rawWord = text.slice(idx, idx + wordLength).trim();
      // Only a boundary reported by the voice can mark a punctuation pause.
      if (!rawWord || PURE_PAUSE_PUNCT_RE.test(rawWord)) {
        activeWordDurationMs = 0;
        closingWord = true;
        opts.onOpenness?.(0);
        return;
      }
      const word = rawWord.replace(END_PUNCT_RE, "");
      const wordEnd = idx + wordLength;
      const now = performance.now();
      const afterPause = closingWord && now - activeWordStartMs >= activeWordDurationMs;
      activeWordStartMs = now;
      closingWord = wordEnd >= spokenEnd || END_PUNCT_RE.test(rawWord) || FOLLOWING_PAUSE_RE.test(text.slice(wordEnd));
      activeWordDurationMs = closingWord
        ? Math.min(1020, 190 + word.length * 92)
        : Math.max(150, Math.min(480, word.length * 64));
      activeWordPeak = Math.min(0.8, 0.62 + word.length * 0.022);
      if (opts.lang === "en") {
        const vowelGroups = word.match(/[aeiouy]+/gi)?.length ?? 1;
        const silentE = vowelGroups > 1 && /[^aeiouy]e$/i.test(word);
        activeSyllables = Math.min(5, vowelGroups - Number(silentE));
      } else {
        activeSyllables = Math.min(5, Math.max(1, Math.round(word.length / 3)));
      }
      // Start gently from a pause. Between continuous words the scheduled
      // envelope takes over, avoiding an abrupt reset at every boundary.
      if (afterPause) opts.onOpenness?.(0.14);
    };

    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    // A voice may report a word boundary late or omit one entirely. Once a
    // word estimate runs out, keep a gentle rhythm unless it ends in a pause.
    // An estimated pause only closes the mouth. End/poll owns playback state.
    const envelopeTimer = window.setInterval(() => {
      if (settled || !mouthActive) return;
      const now = performance.now();
      const elapsed = now - activeWordStartMs;
      if (activeWordDurationMs === 0 || elapsed >= activeWordDurationMs) {
        opts.onOpenness?.(closingWord ? 0 : null);
        return;
      }
      const progress = elapsed / activeWordDurationMs;
      const pulse = Math.abs(Math.sin(progress * Math.PI * activeSyllables));
      const attack = Math.min(1, elapsed / 55);
      const release = closingWord ? Math.min(1, (activeWordDurationMs - elapsed) / 100) : 1;
      opts.onOpenness?.(activeWordPeak * (0.55 + 0.45 * pulse) * attack * release);
    }, 35);

    // Allow for missing end events without imposing a deadline on active speech.
    const pollTimer = window.setInterval(() => {
      if (settled) return;
      const now = performance.now();
      if (synth.paused) {
        stopMouth();
        idleSince = null;
      } else if (synth.speaking) {
        markStarted();
        idleSince = null;
      } else if (!started && now - queuedAt > 8000) {
        finish(false);
        cancelBrowserTts();
      } else if (synth.pending) {
        stopMouth();
        idleSince = null;
      } else if (started) {
        idleSince ??= now;
        const idleMs = now - idleSince;
        if (idleMs >= 80) stopMouth();
        if (idleMs >= 400) finish(true);
      }
    }, 60);

    try {
      synth.speak(utterance);
    } catch {
      finish(false);
    }
  });
}
