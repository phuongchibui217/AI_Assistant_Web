import type { SupportedLang } from "@/lib/lang-detect";

/**
 * Mic input language selection.
 *
 * Two STT paths back this (verified by spike 2026-07-27):
 *  - Streaming `long` model: live interim (text appears while speaking), but
 *    only supports the 9 languages in STREAM_STT_CODE. Pass the single BCP-47
 *    code for the picked language.
 *  - Chirp `["auto"]` (sync record-then-POST): every language, correct
 *    detection, but NO interim. Used for "auto" and the 4 languages the `long`
 *    model rejects (th/fil/my/ne).
 */

export type MicLang = SupportedLang | "auto";

/** Languages the `long` streaming model accepts, mapped to their STT BCP-47
 *  code. Membership here = "use streaming (interim)"; anything else = Chirp. */
export const STREAM_STT_CODE: Partial<Record<SupportedLang, string>> = {
  ja: "ja-JP",
  en: "en-US",
  ko: "ko-KR",
  zh: "cmn-Hans-CN",
  zhTW: "cmn-Hant-TW",
  ru: "ru-RU",
  vi: "vi-VN",
  id: "id-ID",
  pt: "pt-BR",
};

export function isStreamingLang(lang: MicLang): lang is SupportedLang {
  return lang !== "auto" && lang in STREAM_STT_CODE;
}

/** Picker options. Names are shown in their own language (picker convention);
 *  `stream` drives the "live text" hint + grouping in the UI. */
export const MIC_LANG_OPTIONS: Array<{
  code: MicLang;
  name: string;
  flag: string;
  stream: boolean;
}> = [
  { code: "auto", name: "Auto", flag: "🌐", stream: false },
  { code: "ja", name: "日本語", flag: "🇯🇵", stream: true },
  { code: "en", name: "English", flag: "🇺🇸", stream: true },
  { code: "ko", name: "한국어", flag: "🇰🇷", stream: true },
  { code: "zh", name: "简体中文", flag: "🇨🇳", stream: true },
  { code: "zhTW", name: "繁體中文", flag: "🇹🇼", stream: true },
  { code: "ru", name: "Русский", flag: "🇷🇺", stream: true },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳", stream: true },
  { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩", stream: true },
  { code: "pt", name: "Português", flag: "🇧🇷", stream: true },
  { code: "th", name: "ไทย", flag: "🇹🇭", stream: false },
  { code: "fil", name: "Filipino", flag: "🇵🇭", stream: false },
  { code: "my", name: "မြန်မာ", flag: "🇲🇲", stream: false },
  { code: "ne", name: "नेपाली", flag: "🇳🇵", stream: false },
];

export function micLangOption(code: MicLang) {
  return MIC_LANG_OPTIONS.find((o) => o.code === code) ?? MIC_LANG_OPTIONS[0];
}
