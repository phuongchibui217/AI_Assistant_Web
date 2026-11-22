import { sttLangToSupported, type SupportedLang } from "@/lib/lang-detect";

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

const LANGUAGE_LABELS: Record<SupportedLang, { name: string; flag: string }> = {
  ja: { name: "日本語", flag: "🇯🇵" },
  en: { name: "English", flag: "🇺🇸" },
  ko: { name: "한국어", flag: "🇰🇷" },
  zh: { name: "简体中文", flag: "🇨🇳" },
  zhTW: { name: "繁體中文", flag: "🇹🇼" },
  ru: { name: "Русский", flag: "🇷🇺" },
  vi: { name: "Tiếng Việt", flag: "🇻🇳" },
  id: { name: "Bahasa Indonesia", flag: "🇮🇩" },
  pt: { name: "Português", flag: "🇧🇷" },
  th: { name: "ไทย", flag: "🇹🇭" },
  fil: { name: "Filipino", flag: "🇵🇭" },
  my: { name: "မြန်မာ", flag: "🇲🇲" },
  ne: { name: "नेपाली", flag: "🇳🇵" },
};

export const TRANSLATE_LANG_OPTIONS = (Object.keys(LANGUAGE_LABELS) as SupportedLang[]).map(
  (code) => ({ code, ...LANGUAGE_LABELS[code] }),
);

export const MIC_LANG_OPTIONS = (["ja", "vi", "en", "zh"] as const).map(
  (code) => ({ code, ...LANGUAGE_LABELS[code] }),
);

export function micLangOption(code: MicLang) {
  return MIC_LANG_OPTIONS.find((o) => o.code === code) ?? { code: "en", ...LANGUAGE_LABELS.en };
}

function configuredMicLang(value: string) {
  const lang = sttLangToSupported(value);
  return MIC_LANG_OPTIONS.find((o) => o.code === (lang === "zhTW" ? "zh" : lang))?.code;
}

export function resolveDefaultMicLang(setting: string, locale: string): MicLang {
  return configuredMicLang(setting) ?? configuredMicLang(locale) ?? "en";
}
