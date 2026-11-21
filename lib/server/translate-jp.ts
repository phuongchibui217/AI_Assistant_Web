import { generateFlashContent } from "@/lib/server/gemini-flash";
import { RAG_TRANSLATE_MODEL } from "@/lib/server/models";

/**
 * Translate arbitrary user text to Japanese for KB retrieval. The Japanese KB
 * embeds far from a non-Japanese query even when the topic matches exactly, so
 * both the answer path and the suggestion answerability check must retrieve
 * with a Japanese query. Shared here so the two callers stay in lock-step - in
 * particular the WisePlanning glossary, so a suggestion is validated against
 * the SAME text the answer path will actually retrieve with.
 *
 * The translated query is used ONLY for RAG retrieval embedding. Fails silently
 * (returns the original text) so a translation outage never blocks retrieval.
 */
export async function translateToJapanese(
  text: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const result = await generateFlashContent(
      text,
      {
        model: RAG_TRANSLATE_MODEL,
        thinkingBudget: 0,
        maxOutputTokens: 256,
        temperature: 0,
        systemInstruction:
          "You are helping an enterprise knowledge base assistant. Translate the user's text to natural Japanese for document search. Output ONLY the Japanese translation, nothing else. If the text is already Japanese, output it unchanged.",
      },
      signal,
    );
    return result.text.trim() || text;
  } catch {
    return text;
  }
}
