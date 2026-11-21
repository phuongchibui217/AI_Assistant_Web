import { generateFlashContent } from "@/lib/server/gemini-flash";
import { RAG_TRANSLATE_MODEL } from "@/lib/server/models";
import type { SupportedLang } from "@/lib/lang-detect";

// Same map as chitchat/suggestions/rag-client (each keeps its own local copy
// today - not worth centralising for one more consumer).
const LANG_NAMES: Record<SupportedLang, string> = {
  ja: "Japanese (日本語)",
  en: "English",
  ko: "Korean (한국어)",
  zh: "Simplified Chinese (简体中文)",
  zhTW: "Traditional Chinese (繁體中文)",
  ru: "Russian (Русский)",
  vi: "Vietnamese (Tiếng Việt)",
  id: "Indonesian (Bahasa Indonesia)",
  my: "Burmese (မြန်မာ)",
  ne: "Nepali (नेपाली)",
  th: "Thai (ไทย)",
  fil: "Filipino (Tagalog)",
  pt: "Portuguese (Português)",
};

/**
 * Interpreter mode: translate arbitrary text into `targetLang` and return
 * ONLY the translation - no answer, no grounding, no persona. Generalises
 * `translateToJapanese` (which is hardcoded to Japanese for RAG retrieval)
 * to an arbitrary target for the Translate-mode top-bar toggle.
 *
 * Fails by returning the original text unchanged so a translate-mode turn
 * never comes back empty if Gemini hiccups.
 */
export async function translateText(
  text: string,
  targetLang: SupportedLang,
  signal: AbortSignal,
): Promise<string> {
  const targetName = LANG_NAMES[targetLang] ?? targetLang;
  try {
    const result = await generateFlashContent(
      text,
      {
        model: RAG_TRANSLATE_MODEL,
        thinkingBudget: 0,
        maxOutputTokens: 1024,
        temperature: 0,
        systemInstruction:
          `You are a professional simultaneous interpreter. Translate the user's ` +
          `text into ${targetName}, keeping the phrasing natural and idiomatic ` +
          `for a native speaker - not a stiff word-for-word translation. ` +
          `However, never change the actual meaning: do not infer time-of-day, ` +
          `context, or situation that is not explicitly stated in the source ` +
          `(e.g. a generic greeting must stay a generic greeting - never assume ` +
          `"good morning" unless the source specifically says so). When in ` +
          `doubt between two natural phrasings, pick the one closer to the ` +
          `source's literal meaning. Output ONLY the translation, nothing else ` +
          `- no notes, no quotation marks, no explanation. If the text is ` +
          `already in ${targetName}, output it unchanged.`,
      },
      signal,
    );
    return result.text.trim() || text;
  } catch {
    return text;
  }
}
