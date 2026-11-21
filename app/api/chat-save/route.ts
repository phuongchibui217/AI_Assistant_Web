import { NextResponse } from "next/server";

import { appendDemoChatRecord } from "@/lib/server/demo-store";

/**
 * Server-side proxy that persists a finished Q&A turn to the admin chat
 * history (`POST /api/chat` on the rag-service). Mirrors `rag/query/route.ts`:
 * keeps `RAG_SERVICE_URL` off the client bundle and side-steps CORS on the
 * backend container.
 *
 * The backend route requires no auth, so we forward the JSON as-is. This is a
 * best-effort log - the caller fires it forget-style, and a failure here must
 * never surface to the user, so we still return 2xx-ish shapes quietly.
 */

const DEFAULT_RAG_URL =
  process.env.NODE_ENV === "production"
    ? "http://rag-api:8001"
    : "http://127.0.0.1:8001";

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || DEFAULT_RAG_URL;

const FETCH_TIMEOUT_MS = 8_000;

type ChatSaveBody = {
  source?: string;
  session_id?: string;
  question_body?: string;
  question_at?: string;
  answer_body?: string;
  answer_at?: string;
};

export async function POST(req: Request): Promise<Response> {
  let body: ChatSaveBody;
  try {
    body = (await req.json()) as ChatSaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.question_body !== "string" || typeof body.answer_body !== "string") {
    return NextResponse.json(
      { error: "Missing question_body/answer_body" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${RAG_SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: body.source ?? "web",
        session_id: body.session_id ?? null,
        question_body: body.question_body,
        question_at: body.question_at ?? null,
        answer_body: body.answer_body,
        answer_at: body.answer_at ?? null,
      }),
      signal: controller.signal,
    });

    if (upstream.ok) {
      const text = await upstream.text();
      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
        },
      });
    }
    // Upstream returned non-OK: persist locally so Admin -> Chat History stays live
    const saved = appendDemoChatRecord({
      sessionId: body.session_id,
      source: body.source,
      question: body.question_body,
      answer: body.answer_body,
      questionAt: body.question_at,
      answerAt: body.answer_at,
    });
    return NextResponse.json({ ok: true, demo: true, record: saved });
  } catch {
    // Offline upstream: persist locally so Admin -> Chat History shows live chats
    const saved = appendDemoChatRecord({
      sessionId: body.session_id,
      source: body.source,
      question: body.question_body,
      answer: body.answer_body,
      questionAt: body.question_at,
      answerAt: body.answer_at,
    });
    return NextResponse.json({ ok: true, demo: true, record: saved });
  } finally {
    clearTimeout(timeout);
  }
}
