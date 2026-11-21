/**
 * Markdown post-processing helpers ported 1:1 from Unity
 * `RAGOrchestratorV2.StripMarkdownForTTS` and `FormatMarkdownForDisplay`.
 *
 * Flash regularly answers with markdown bullets (`* item`) and bold
 * (`**term**`). TTS reads those symbols aloud as "asterisk" / "underscore"
 * which sounds awful; the chat bubble also looks noisy with bare stars.
 *
 * Two output flavours:
 *   - `stripMarkdownForTts`  -> plain prose, no symbols, fed to TTS.
 *   - `formatMarkdownForDisplay` -> Unicode bullets + bold marker, fed to chat.
 *
 * Keep `cleanedAnswer.replace(/\[\[.*?\]\]/g, "")` before either call if your
 * prompt teaches the model to emit inline `[[src:]]` citation tags. The
 * current prompt does not, so we skip that step.
 */

/**
 * Citation markers the model echoes from the grounded prompt: a bracketed
 * number, or a comma/、-separated list of numbers - `[1]`, `［１］`, `[2, 3, 4, 5]`,
 * `[2、3]`. They never match the displayed reference list (sources are deduped),
 * so per client feedback they are removed from BOTH the spoken text and the
 * chat bubble. Brackets containing anything other than digits + separators
 * (e.g. `[注]`, `[1日]`) are left untouched.
 */
export const CITATION_MARKER_RE =
  /[[［]\s*[0-9０-９]+(?:\s*[,，、]\s*[0-9０-９]+)*\s*[\]］]/g;

/**
 * Plain-text version safe to send to TTS. Drops every markdown marker.
 */
export function stripMarkdownForTts(input: string): string {
  if (!input) return input;
  let text = input;

  // 1) Fenced code blocks ```lang\n...``` -> body only.
  text = text.replace(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```/g, "$1");
  // 2) Inline code `code` -> code.
  text = text.replace(/`([^`]+)`/g, "$1");
  // 3) Bold/italic wrappers.
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  // Italic *x* / _x_ but not mid-word (a*b*c stays). The leading boundary uses a
  // captured (start-or-non-word) group re-emitted as $1 INSTEAD of a lookbehind:
  // JS regex lookbehind ((?<!...)) is a parse-time SyntaxError on iOS/iPadOS
  // Safari < 16.4, which would break this whole module on older devices.
  // Lookahead ((?!\w)) is fine everywhere, so only the lookbehind is rewritten.
  text = text.replace(/(^|\W)\*([^*\n]+)\*(?!\w)/g, "$1$2");
  text = text.replace(/(^|\W)_([^_\n]+)_(?!\w)/g, "$1$2");
  // 4) Links [text](url) -> text.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // 4b) Bare citation markers [1] [2] [3] and comma lists [2, 3, 4, 5]. The
  // model echoes the source numbers from the grounded prompt; TTS would read
  // them aloud as "ichi" / "one". Removed from the display path too (see
  // CITATION_MARKER_RE) since the numbers don't match the reference list.
  text = text.replace(CITATION_MARKER_RE, "");
  // 5) Bullet list markers at line start.
  text = text.replace(/^[\t ]*[\*\-\+][\t ]+/gm, "");
  // 5b) Unicode bullet glyphs at line start (• ・ ● ○ ◦ ▪ ‣ ∙). JP answers use
  // ・/• directly and the ASCII rule above misses them, so TTS read the glyph
  // aloud ("nakaguro" for ・). Trailing space optional - JP bullets often omit
  // it. Anchored to line start so a mid-line ・ (ジョン・スミス, AI・IoT) - a
  // legitimate separator that reads as a short pause - is preserved.
  text = text.replace(/^[\t 　]*[•・●○◦▪‣∙][\t 　]*/gm, "");
  // 6) Numbered list "1. " / "1) " at line start.
  text = text.replace(/^[\t ]*\d+[.)][\t ]+/gm, "");
  // 7) Headings.
  text = text.replace(/^[\t ]*#{1,6}[\t ]+/gm, "");
  // 8) Blockquote ">" at line start.
  text = text.replace(/^[\t ]*>[\t ]?/gm, "");
  // 9) Stray double markers (e.g. "** foo" without closing).
  text = text.replace(/\*\*/g, "").replace(/__/g, "");
  // 10) Lonely bullet markers on their own line.
  text = text.replace(/^[\t ]*[\*\-\+][\t ]*$\n?/gm, "");
  // 11) Any remaining bare asterisks - TTS would say "asterisk".
  text = text.replace(/\*/g, "");
  // 12) Quote characters - Cloud TTS reads ASCII `"` and `'` aloud as the
  // word "quote" / "apostrophe" mid-sentence, which sounded jarring on
  // direct-speech RAG answers ("the examiner asks, \"Is this a house?\"").
  // Strip ASCII straight quotes + the common Unicode smart-quote and CJK
  // bracket families. Apostrophes in contractions (don't, it's) become a
  // space, which Cloud TTS pronounces normally.
  text = text.replace(/["'`´‘’‚‛“”„‟«»‹›「」『』〈〉]/g, "");
  // 12b) Bare URLs (client spec 2026-07-30 - the URL is now a clickable link
  // in the bubble; TTS reading out "https colon slash slash..." aloud is
  // useless and jarring). Same URL_RE body as chat-panel's linkifyText.
  text = text.replace(/https?:\/\/[^\s<>"'「」『』（）()]+/g, "");
  // 13) Postal mark 〒 (U+3012): Cloud/Fish TTS has no reading for it and emits
  // a garbled "ダ" before the postal code (client report on the address
  // answer). Speak it as its meaning so "〒060-0061" reads "郵便番号060-0061".
  text = text.replace(/〒\s*/g, "郵便番号 ");
  // 14) Collapse multiple blank lines.
  text = text.replace(/\n{2,}/g, "\n");

  return text.trim();
}

/**
 * Chat-bubble version. Converts bullets to the Unicode bullet glyph (•) and
 * strips noise; preserves bold markers as `**...**` because the chat panel
 * renders plain text - rendering as `<b>` requires risky HTML injection.
 */
export function formatMarkdownForDisplay(input: string): string {
  if (!input) return input;
  let text = input;

  // 1) Fenced code blocks ```lang\n...``` -> body only (panel renders plain text).
  text = text.replace(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```/g, "$1");
  // 2) Inline code `code` -> code.
  text = text.replace(/`([^`]+)`/g, "$1");
  // 3) Heading markers `#`..`######` at line start -> drop the marker, keep text.
  text = text.replace(/^[\t ]*#{1,6}[\t ]+/gm, "");
  // 4) Blockquote ">" at line start.
  text = text.replace(/^[\t ]*>[\t ]?/gm, "");
  // 5) Links [text](url) -> text.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // 6) Bare citation markers [1] [2] / [2, 3] - they don't match the reference
  // list, so drop them from the bubble too (parity with the TTS path).
  text = text.replace(CITATION_MARKER_RE, "");
  // 7) Bullet markers at line start: `*`, `-`, `+` -> `•`. Numbered lists
  // ("1. ") read naturally in the bubble, so they are left untouched.
  text = text.replace(/^[\t ]*[\*\-\+][\t ]+/gm, "• ");
  // 8) Lonely bullet markers (no content after) -> drop entire line.
  text = text.replace(/^[\t ]*[\*\-\+][\t ]*$\n?/gm, "");
  // 9) Drop any stray bold markers that survived (we don't render bold).
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*/g, "");
  // 10) Collapse multiple blank lines.
  text = text.replace(/\n{2,}/g, "\n");

  return text.trim();
}
