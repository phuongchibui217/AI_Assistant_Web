import { NextResponse } from "next/server";

import { citationsFromChunks, type Citation } from "@/lib/citations";
import type { RagChunk, RagQueryResponse } from "@/lib/rag-client";

/**
 * Chunks-only retrieval endpoint. Unlike {@link ../ask/route.ts} this does
 * NOT call Gemini Flash to generate a grounded answer - it returns the raw
 * chunks (and derived citations) so the caller can feed them into Gemini
 * Live for native-audio grounded reply. Used by the voice path for better
 * voice quality and consistency across chitchat/KB turns (feedback items
 * 15, 16, 30).
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

export type RagRetrieveResponse = {
  chunks: RagChunk[];
  citations: Citation[];
  outOfKb: boolean;
};

export async function POST(req: Request): Promise<Response> {
  let payload: { query?: unknown; topK?: unknown; minScore?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }
  const query = payload.query.trim();
  const topK = typeof payload.topK === "number" ? payload.topK : 5;
  const minScore = typeof payload.minScore === "number" ? payload.minScore : 0.5;

  let ragResult: RagQueryResponse;
  try {
    const ragRes = await fetch(`${RAG_SERVICE_URL}/api/ai/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: topK,
        min_score: minScore,
        filters: null,
      }),
      signal: req.signal,
    });
    if (!ragRes.ok) {
      const text = await ragRes.text().catch(() => "");
      return NextResponse.json(
        { error: `RAG upstream ${ragRes.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    ragResult = (await ragRes.json()) as RagQueryResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `RAG fetch failed: ${msg}` },
      { status: 502 },
    );
  }

  const chunks = (ragResult.results ?? []) as RagChunk[];
  const body: RagRetrieveResponse = {
    chunks,
    citations: citationsFromChunks(chunks),
    outOfKb: ragResult.out_of_kb || chunks.length === 0,
  };
  return NextResponse.json(body);
}
