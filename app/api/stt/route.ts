import { NextResponse } from "next/server";

import { SttError, transcribeAudio } from "@/lib/server/cloud-stt-v2";

// gRPC Speech client + node fs - must run on the Node runtime, not edge.
export const runtime = "nodejs";

/**
 * Speech-to-text endpoint for the push-to-talk mic. The client records the
 * whole utterance (webm/opus) and POSTs the raw bytes here on release; we run
 * one Google STT v2 Chirp request with automatic language detection and return
 * the transcript + detected language. Replaces the v1 streaming WS bridge for
 * the web client (the bridge stays for Unity until it migrates).
 *
 *   POST /api/stt   body: audio bytes (Content-Type = recorder mime)
 *   200 { text, lang }
 *   400 empty body   502 recognise failure
 */

// Cap the upload so a stuck recorder can't post an unbounded blob. A minute of
// webm/opus is well under this; push-to-talk clips are a few seconds.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ error: "Empty audio" }, { status: 400 });
  }
  if (buf.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }

  try {
    const { text, lang } = await transcribeAudio(buf);
    return NextResponse.json({ text, lang }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const status = err instanceof SttError ? (err.status ?? 502) : 502;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/stt]", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
