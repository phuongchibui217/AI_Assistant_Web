import { NextResponse } from "next/server";

import { translateText } from "@/lib/server/translate";
import { VOICE_FOR_LANG } from "@/lib/lang-detect";
import type { SupportedLang } from "@/lib/lang-detect";

/**
 * Interpreter-mode endpoint (top-bar Translate toggle, client spec
 * 2026-08-07): translate `text` into `targetLang` and return ONLY the
 * translation - bypasses classify-kb/RAG/chitchat entirely, this is not an
 * answer to a question.
 */
export async function POST(req: Request): Promise<Response> {
  let payload: { text?: unknown; targetLang?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    return NextResponse.json({ error: "Missing 'text'" }, { status: 400 });
  }
  if (
    typeof payload.targetLang !== "string" ||
    !Object.hasOwn(VOICE_FOR_LANG, payload.targetLang)
  ) {
    return NextResponse.json({ error: "Invalid 'targetLang'" }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json({ error: "Translation service is not configured" }, { status: 503 });
  }

  try {
    const text = await translateText(payload.text.trim(), payload.targetLang as SupportedLang, req.signal);
    return NextResponse.json({ text });
  } catch (error) {
    if (req.signal.aborted) return NextResponse.json({ error: "Aborted" }, { status: 499 });
    console.warn("[/api/translate] Translation failed:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 502 });
  }
}
