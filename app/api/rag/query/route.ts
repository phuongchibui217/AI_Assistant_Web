import { NextResponse } from "next/server";

/**
 * Server-side proxy to the RAG service. Keeps `RAG_SERVICE_URL` off the
 * client bundle and side-steps any CORS configuration on the rag-service
 * container.
 *
 * The body is forwarded as-is; we only validate the shape exists.
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

const FETCH_TIMEOUT_MS = 15_000;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (
    body === null ||
    typeof body !== "object" ||
    typeof (body as { query?: unknown }).query !== "string"
  ) {
    return NextResponse.json({ error: "Missing 'query' field" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Backend 2026-05-23 refactor: legacy `/rag/query` removed; the new
    // FastAPI router exposes the same handler under `/api/ai/query` and
    // accepts `filters` (plural) instead of `filter`.
    const upstream = await fetch(`${RAG_SERVICE_URL}/api/ai/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: isAbort ? "RAG timeout" : `RAG upstream error: ${msg}` },
      { status: isAbort ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
