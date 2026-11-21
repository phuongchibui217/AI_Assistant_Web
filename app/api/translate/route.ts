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
    !(payload.targetLang in VOICE_FOR_LANG)
  ) {
    return NextResponse.json({ error: "Invalid 'targetLang'" }, { status: 400 });
  }

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const text = await translateText(
    payload.text.trim(),
    payload.targetLang as SupportedLang,
    controller.signal,
  );
  return NextResponse.json({ text });
}
