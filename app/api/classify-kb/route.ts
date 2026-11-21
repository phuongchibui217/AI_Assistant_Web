import { NextResponse } from "next/server";

import { classifyQueryLocal } from "@/lib/server/demo-chat";
import { generateFlashContent } from "@/lib/server/gemini-flash";
import { CLASSIFY_MODEL } from "@/lib/server/models";

/**
 * Two-way classifier: decides whether the user's question should be answered
 * from the company knowledge base (RAG) or with free-form conversation via
 * Gemini Live. Feedback 2026-05-25 (items 13, 34 + clarification on 2026-05-26):
 * out-of-scope KB questions should reply "資料なし", but casual chitchat
 * ("hello", "what time is it", "tell me a joke") should still get a natural
 * reply rather than the same stiff fallback.
 *
 * Designed to be cheap and quick:
 *   - Gemini 2.5 Flash-Lite (cheaper + faster than Flash)
 *   - `thinkingBudget=0` to skip internal reasoning tokens
 *   - 1-token answer budget (`KB` or `CHAT`)
 *
 * Total wall time ~200-400ms in practice. Fails open to `KB` so retrieval
 * still happens if the classifier hiccups (safer than missing a real KB hit).
 */

const SYSTEM_PROMPT = `You route a user message to one of two answer pipelines for an AI advisor product. The product is backed by an OPEN knowledge base: admins can upload any reference material - HR rules + payroll, internal procedures, product/service docs, AND general reference documents like Wikipedia articles, geography, history, technical manuals, science explanations, biographies, etc. You DO NOT know what specific documents are uploaded; assume the KB could contain a document on almost any factual topic.

Reply with EXACTLY one token, no punctuation, no explanation:
- "KB"   - any factual / informational question on ANY topic. This includes HR/policy/procedure, but ALSO history, geography, science, products, organisations, definitions, "what is X", "tell me about X", "X の歴史", "X とは", "X は何ですか", etc. If a Wikipedia article or reference book could plausibly answer the question, return KB. When uncertain, prefer KB - a wasted retrieval is cheaper than missing a real document.
- "CHAT" - ONLY these narrow categories: pure greetings ("hello", "こんにちは"), thanks ("ありがとう"), identity questions ("who are you", "あなたは誰"), real-time info the KB cannot have (current weather, current time/date, current news), jokes / role-play, small talk with no factual content. CHAT is the EXCEPTION; KB is the default.

# Follow-up handling (conversation history)
If a 【Conversation history】 block is present, treat the current message in context. A meta-request that refers to the previous assistant answer (translate / rephrase / shorten / give more detail / "in another language" / "それを〜で") is a KB follow-up if the previous answer was factual content - return KB so the same retrieval pipeline re-answers with the new constraint. A meta-request after a pure chitchat turn is still CHAT. Pronouns ("that", "それ", "đó") referring to a KB topic also route KB.

Examples:
- "釧路湿原について教えて" → KB
- "Hokkaido đã từng có các tên gọi nào?" → KB (factual history)
- "What is the paid leave policy?" → KB
- "how many paid leaves do i get each year?" → KB
- "how many do i get it here?" → KB (ambiguous fragment, default to KB)
- "year?" → KB (fragment, default to KB)
- "労務規定の有給休暇は？" → KB
- "Hokkaidoの面積は？" → KB (factual)
- "明治時代の北海道について" → KB (history)
- "Tokyo Tower の高さは？" → KB (reference fact)
- "có nhân viên mới gia nhập thì làm sao?" → KB
- "今日は何曜日？" → CHAT (real-time)
- "今日の東京の天気は？" → CHAT (real-time weather)
- "Tell me a joke" → CHAT
- "Hi how are you" → CHAT
- "Bonjour" → CHAT
- "ありがとう" → CHAT
- "あなたは誰？" → CHAT (identity)
- "hello, can you hear me?" → CHAT

Follow-up examples (with history):
- prev assistant = paid-leave table, user = "could you answer that but in japanese?" → KB
- prev assistant = paid-leave table, user = "もっと短くまとめて" → KB
- prev assistant = paid-leave table, user = "それは？" → KB
- prev assistant = "Hello! How can I help?", user = "in japanese please" → CHAT
- prev assistant = "Hello!", user = "thanks" → CHAT
`;

export async function POST(req: Request): Promise<Response> {
  let payload: { query?: unknown; history?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }
  const query = payload.query.trim();
  // Last few turns let the classifier detect follow-up meta-requests
  // ("answer that in JP", "それは?") that look like CHAT in isolation but
  // are actually KB follow-ups when seen in context. Keep the block small -
  // 4 turns is enough for the immediate prev Q+A plus one earlier exchange.
  const history = Array.isArray(payload.history)
    ? (payload.history as Array<{ role?: unknown; text?: unknown }>)
        .filter(
          (m) =>
            (m.role === "user" || m.role === "model") &&
            typeof m.text === "string" &&
            (m.text as string).trim().length > 0,
        )
        .map((m) => ({ role: m.role as "user" | "model", text: m.text as string }))
        .slice(-4)
    : [];

  let userPrompt = query;
  if (history.length > 0) {
    const lines = history
      .map((m) => {
        const label = m.role === "user" ? "User" : "Assistant";
        const text = m.text.length > 400 ? m.text.slice(0, 400) + "..." : m.text;
        return `${label}: ${text}`;
      })
      .join("\n");
    userPrompt = `【Conversation history】\n${lines}\n\n【Current message】\n${query}`;
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ decision: classifyQueryLocal(query), demo: true });
  }

  try {
    const flash = await generateFlashContent(
      userPrompt,
      {
        // Tried `gemini-3.1-flash-lite` 2026-05-26 - mis-classified greetings
        // ("hello, can you hear me?" -> KB) and 503 spikes on the preview
        // channel made wall time worse, not better. Revert to 2.5-flash-lite
        // until the 3.x line stabilises. Overridable via CLASSIFY_MODEL.
        model: CLASSIFY_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 4,
        thinkingBudget: 0,
      },
      req.signal,
    );
    const raw = flash.text.trim().toUpperCase();
    // Tolerate stray punctuation / quoting from the model.
    const decision = raw.startsWith("CHAT") ? "CHAT" : "KB";
    return NextResponse.json({ decision });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[/api/classify-kb] failed, falling back to local classifier:", msg);
    return NextResponse.json({
      decision: classifyQueryLocal(query),
      error: msg,
      fallback: true,
    });
  }
}
