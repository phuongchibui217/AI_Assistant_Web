/**
 * Split a multi-language answer into TTS-friendly sentences.
 *
 * Punctuation set mirrors Unity `RAGOrchestratorV2.SplitIntoSentences()`:
 *   - JP terminators: 。 ！ ？
 *   - EN terminators: . ! ?
 *   - Hard line breaks count as sentence boundaries too
 *
 * Bullet markers (`- `, `* `, `・`) start a new sentence even without
 * preceding punctuation - they're how Flash often formats listed answers.
 *
 * A period inside a decimal or product name is part of the same sentence.
 */

const HARD_TERMINATORS = new Set(["。", "！", "？", "!", "?", "\n"]);
const TERMINATOR_CHARS = "。！？.!?\n";

// Lower-cased words that take a trailing "." WITHOUT ending a sentence. A "."
// after one of these (or after a single letter - initials "J.", acronyms
// "U.S.", "e.g.") must NOT split, otherwise "Mr. Okudera" was cut after "Mr"
// and the name read as a separate utterance with a jarring pause. Erring toward
// NOT splitting on an ambiguous "." is safe now that sentences are batched.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "mt", "jr", "sr", "vs", "etc",
  "inc", "ltd", "co", "corp", "no", "fig", "dept", "gen", "sen", "rep",
  "gov", "capt", "sgt", "lt", "col", "hon", "rev", "esq", "ave", "blvd", "rd",
]);

export function splitIntoSentences(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const out: string[] = [];
  let buf = "";

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    buf += ch;

    if (HARD_TERMINATORS.has(ch)) {
      flush();
      continue;
    }

    if (ch === ".") {
      // Keep decimals and product names such as "Next.js" together.
      const prev = clean[i - 1];
      const next = clean[i + 1];
      if (prev && next && /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next)) continue;
      // Abbreviations / initials: the letter run ending right before the dot.
      // "Mr."/"Ms."/"Dr." -> known title; single letter -> initial / acronym
      // segment ("J.", "U.S.", "e.g."). Neither ends a sentence.
      let j = i - 1;
      while (j >= 0 && /[A-Za-z]/.test(clean[j])) j--;
      const word = clean.slice(j + 1, i);
      if (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase())) continue;
      flush();
      continue;
    }

    // Bullet break: newline followed by a bullet glyph already handled above.
  }

  if (buf.trim().length > 0) out.push(buf.trim());
  return out.filter((s) => s.length > 0);

  function flush() {
    const trimmed = buf.trim();
    if (trimmed.length > 0) out.push(trimmed);
    buf = "";
  }
}

/**
 * Coalesce already-split sentences into batches whose combined length stays
 * around `targetChars`. Each batch is meant to become ONE TTS request.
 *
 * Why: synthesising one request per sentence resets prosody/timbre at every
 * join - a neural TTS utterance (Fish or Google) shares no context with the
 * next, so each request samples a fresh pitch/energy baseline. Concatenated
 * gaplessly, that is audible as a voice/intonation "jump" at the start of each
 * bullet on long answers (the regression introduced with per-sentence
 * streaming, D2). Fewer, larger requests keep the voice continuous within a
 * batch. Sentences keep their terminators, so each batch still reads with
 * correct sentence-level intonation internally.
 */
const ENDS_WITH_TERMINATOR = /[。！？.!?…]$/;
const ENDS_WITH_CJK = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]$/;

/**
 * Append `piece` to a growing spoken batch, inserting a pause where the model
 * left one out. A batch is spoken as ONE TTS request: joining with a bare space
 * works when `cur` already ends in 。/./! (the terminator cues the pause), but
 * list items / headings emitted WITHOUT trailing punctuation (split off a bare
 * newline) then run together, spoken as one breath (client report: "the line
 * after a punctuation-less newline is spoken continuously"). Insert an explicit
 * stop there, script-matched (。 for Japanese, . for Latin) so an English list
 * isn't given a 。. Used by BOTH the streaming RAG path (`flushTts`) and
 * `batchSentences`. TTS-only text - never reaches the displayed bubble.
 */
export function appendSpoken(cur: string, piece: string): string {
  if (!cur) return piece;
  if (ENDS_WITH_TERMINATOR.test(cur)) return `${cur} ${piece}`;
  return `${cur}${ENDS_WITH_CJK.test(cur) ? "。" : "."} ${piece}`;
}

export function batchSentences(sentences: string[], targetChars = 240): string[] {
  const batches: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    cur = appendSpoken(cur, piece);
    if (cur.length >= targetChars) {
      batches.push(cur);
      cur = "";
    }
  }
  if (cur) batches.push(cur);
  return batches;
}

// Boundary classes for the byte-length splitter below.
const TTS_SENTENCE_END = /[。！？!?\n]/;
const TTS_CLAUSE_BREAK = /[、，,；;：:\s]/;

/** UTF-8 byte length of a single code point - avoids allocating per char. */
function codePointBytes(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/**
 * Hard byte-length splitter for Google Cloud TTS's 5000-byte-per-request limit
 * (it rejects longer `input.text`/`input.ssml` with a 400, which the caller
 * swallows -> a long answer ends up silent and the avatar's mouth stops moving).
 *
 * Returns the text as a single element when it already fits. Otherwise splits
 * into pieces each <= `maxBytes` (UTF-8), breaking at the most natural boundary
 * available so speech rhythm survives:
 *   1. sentence terminators 。 ！ ？ . ! ? and newline (preferred)
 *   2. clause punctuation 、 ， , ； ; ： : and whitespace
 *   3. a hard cut on a code-point boundary (never mid multi-byte char)
 *
 * `maxBytes` defaults to 4000 - safely under the 5000 limit, leaving headroom
 * for the per-chunk lexeme SSML tag overhead added downstream.
 */
export function chunkTextByBytes(text: string, maxBytes = 4000): string[] {
  if (new TextEncoder().encode(text).length <= maxBytes) {
    return text.trim() ? [text] : [];
  }

  const chars = Array.from(text); // code points - never split a surrogate pair
  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  let lastSentence = -1; // index AFTER a sentence terminator in current chunk
  let lastClause = -1; // index AFTER a clause break in current chunk

  const mark = (i: number) => {
    if (TTS_SENTENCE_END.test(chars[i])) lastSentence = i + 1;
    else if (TTS_CLAUSE_BREAK.test(chars[i])) lastClause = i + 1;
  };
  const push = (from: number, to: number) => {
    const s = chars.slice(from, to).join("").trim();
    if (s) chunks.push(s);
  };

  for (let i = 0; i < chars.length; i++) {
    const cb = codePointBytes(chars[i].codePointAt(0) ?? 0);
    if (bytes + cb > maxBytes && i > start) {
      const cut =
        lastSentence > start ? lastSentence : lastClause > start ? lastClause : i;
      push(start, cut);
      // Re-account from the cut point for the next chunk.
      start = cut;
      bytes = 0;
      lastSentence = -1;
      lastClause = -1;
      for (let j = start; j < i; j++) {
        bytes += codePointBytes(chars[j].codePointAt(0) ?? 0);
        mark(j);
      }
    }
    bytes += cb;
    mark(i);
  }
  push(start, chars.length);
  return chunks;
}

/**
 * Streaming sentence buffer: feed text chunks via `push()`, get back only the
 * sentences that are fully terminated. Partial trailing text stays in the
 * buffer until more arrives. `flush()` drains whatever's left at end-of-stream.
 *
 * Lets the RAG path start TTS synthesis on the first complete sentence
 * (~1-2 s in) instead of waiting for the full Flash response (~5-6 s).
 */
export function makeSentenceBuffer(): {
  push: (text: string) => string[];
  flush: () => string[];
} {
  let buf = "";
  return {
    push(text: string): string[] {
      buf += text;
      const parts = splitIntoSentences(buf);
      if (parts.length === 0) return [];
      // If the buffer ends on a terminator the last sentence is closed and we
      // can drain the whole list. Otherwise the last sentence is partial and
      // must stay buffered until more text arrives.
      const tail = buf.replace(/\s+$/, "").slice(-1);
      const closed = TERMINATOR_CHARS.includes(tail);
      if (closed) {
        buf = "";
        return parts;
      }
      const partial = parts.pop() ?? "";
      buf = partial;
      return parts;
    },
    flush(): string[] {
      const rest = buf.trim();
      buf = "";
      return rest ? [rest] : [];
    },
  };
}
