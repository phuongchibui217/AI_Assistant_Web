import type { RagChunk } from "@/lib/rag-client";

/**
 * Citation surfaced in chat: where the answer came from. Built either from the
 * retrieved chunks (always available) or from inline `[[src: filename]]` tags
 * that some prompts ask the model to emit. Sources are deduplicated by
 * filename so each document appears once in the chat footnote.
 */
export type Citation = {
  filename: string;
  /** Highest chunk score among occurrences. Used for ordering. */
  score: number;
  /** Path returned by the rag-service, if available. */
  sourcePath?: string;
  /** Original web URL, if the file was ingested via Upload URL. Used to
   *  navigate the host page top-level on citation click when embedded on
   *  that same site (2026-07-31 client spec). */
  sourceUrl?: string;
};

const INLINE_TAG_RE = /\[\[(?:src:\s*)?([^\]]+)\]\]/g;

/**
 * Strip inline `[[src: filename]]` (or `[[filename]]`) markers from a stream
 * of text and return the cleaned text plus the filenames it referenced. Used
 * if the prompt teaches the model to emit those tags - safe to call on plain
 * text too; it returns empty filenames.
 */
export function parseInlineCitations(text: string): {
  clean: string;
  filenames: string[];
} {
  const filenames: string[] = [];
  const clean = text.replace(INLINE_TAG_RE, (_, name: string) => {
    filenames.push(name.trim());
    return "";
  });
  return { clean, filenames };
}

// Retrieval runs at a low min_score (0.42) for cross-lingual recall, so the
// top-k often includes filler chunks that merely "score least-badly" - e.g. a
// "What is Hoi An?" answer grounded on the Hoi An doc but trailed by the
// company profile + unrelated wiki pages at ~0.5. Those are fed to the model as
// context but should NOT be shown as citations: a source chip says "this is
// where the answer came from". A document is only a real source if its best
// chunk scores within this gap of the top retrieved chunk; filler sits clearly
// below the genuine match (real matches ~0.64+, noise ~0.5-0.55).
const CITATION_SCORE_GAP = 0.1;

/**
 * Build a list of citations from RAG chunks, deduped by filename. Order is
 * highest score first so the most relevant document is shown leftmost. Chunks
 * scoring more than CITATION_SCORE_GAP below the top match are dropped as
 * retrieval filler, so irrelevant documents do not appear as sources.
 */
export function citationsFromChunks(chunks: RagChunk[]): Citation[] {
  if (chunks.length === 0) return [];
  const topScore = Math.max(...chunks.map((c) => c.score));
  const cutoff = topScore - CITATION_SCORE_GAP;
  const byName = new Map<string, Citation>();
  for (const c of chunks) {
    if (c.score < cutoff) continue;
    const existing = byName.get(c.filename);
    if (!existing || c.score > existing.score) {
      byName.set(c.filename, {
        filename: c.filename,
        score: c.score,
        sourcePath: c.source_path,
        sourceUrl: c.source_url,
      });
    }
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}
