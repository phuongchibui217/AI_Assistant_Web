import { NextResponse } from "next/server";

import { generateDemoSuggestions } from "@/lib/server/demo-chat";
import { generateFlashContent, FlashError } from "@/lib/server/gemini-flash";
import { RAG_ANSWER_MODEL, SUGGESTIONS_MODEL } from "@/lib/server/models";
import { translateToJapanese } from "@/lib/server/translate-jp";

/**
 * Suggested-questions endpoint. Given the most recent user question + model
 * answer, asks Flash to propose 3 short follow-up questions in the SAME
 * language the user used. Ports the intent of Unity's suggested-questions
 * feature but fixes the bug the client flagged - the old build picked
 * unrelated canned items because it was not grounded in the previous Q+A.
 *
 * Returns `{ suggestions: string[] }`. Empty array on parse failure rather
 * than throwing - suggestions are decorative, not blocking.
 */

const SYSTEM_PROMPT = `# Role
You propose follow-up questions for an AI advisor backed by an OPEN knowledge
base. The KB can hold any reference material the admin uploads: HR policies
and internal procedures, but ALSO general reference (Wikipedia articles,
science, history, geography, biographies, product docs, technical manuals).
Do not assume the topic in advance - derive it from the previous answer.

# Strict output format
- Output EXACTLY 3 lines, one short follow-up question per line.
- No numbering, no bullets, no quotes, no markdown, no commentary.
- Match the language of the USER QUESTION exactly (JP, EN, KO, ZH, RU, VI, ID,
  MY, NE). Detect from the script of the user question, NOT the answer.
- Length: JP/KO/ZH max ~20 chars; EN max ~40 chars; other languages ~30 chars.

# Quality rules (apply in order, hardest first)
1. Each follow-up MUST stay on the SAME topic as the previous answer. If the
   answer is about string theory, propose string-theory follow-ups; if about
   paid leave, propose paid-leave follow-ups. NEVER shift to an unrelated
   domain (do not propose HR questions after a physics answer, or vice versa).
2. Drill into a SPECIFIC term, number, person, place, or claim already named
   in the answer (e.g. if the answer mentions "one-dimensional strings",
   ask about dimensions or vibration modes; if it mentions "勤続6ヶ月以上 →
   10日", ask about another tenure tier or the carry-over rule).
3. Cover three DIFFERENT angles when possible: (a) a deeper detail or edge
   case, (b) a related concept or next step in the same domain, (c) a
   contrasting / comparative angle (alternative theories, exceptions, history).
4. Never paraphrase the original user question. Never produce 3 variants of
   the same question.
5. If the previous answer was "資料に該当する情報がありません" (or its
   translation), suggest 3 nearby topics likely covered in the KB given the
   user's question - do NOT default to HR boilerplate unless the question
   itself was HR-related.`;

// Same code->name map used by the RAG/chitchat prompts. The client passes the
// resolved conversation language (detectLang/Chirp), which is far more reliable
// than letting the model script-detect - a JP-glossary-heavy English answer kept
// dragging the suggestions to Japanese.
const LANG_NAMES: Record<string, string> = {
  ja: "Japanese (日本語)",
  en: "English",
  ko: "Korean (한국어)",
  zh: "Simplified Chinese (简体中文)",
  zhTW: "Traditional Chinese (繁體中文)",
  ru: "Russian (Русский)",
  vi: "Vietnamese (Tiếng Việt)",
  id: "Indonesian (Bahasa Indonesia)",
  my: "Burmese (မြန်မာ)",
  ne: "Nepali (नेपाली)",
  th: "Thai (ไทย)",
  fil: "Filipino (Tagalog)",
  pt: "Portuguese (Português)",
};

function buildUserPrompt(
  question: string,
  answer: string,
  history?: Array<{ role: string; text: string }>,
  lang?: string,
): string {
  // Hard language pin when the client supplies the resolved language. Overrides
  // the system prompt's "detect from the question script" heuristic, which a
  // small model ignores when the answer is full of another language's terms.
  const langName = lang ? LANG_NAMES[lang] : undefined;
  const langDirective = langName
    ? `# Output language (HARD RULE)\nWrite all 3 follow-up questions in ${langName} ONLY, regardless of the language of the answer or the reference materials.\n`
    : "";
  // Truncate the answer if it's very long - Flash-Lite reads faster on a
  // tight context. Increased from 800 → 1500 so longer policy answers (e.g.
  // multi-tier leave tables) are not cut before their key specifics.
  const truncatedAnswer =
    answer.length > 1500 ? answer.slice(0, 1500) + "..." : answer;

  // Build optional conversation history block so the model can propose
  // follow-ups that continue the full dialogue thread, not just the last Q+A.
  let historyBlock = "";
  if (history && history.length > 0) {
    const lines = history
      .map((m) => {
        const label = m.role === "user" ? "User" : "Assistant";
        // Truncate individual history messages to keep prompt size bounded.
        const text = m.text.length > 300 ? m.text.slice(0, 300) + "..." : m.text;
        return `${label}: ${text}`;
      })
      .join("\n");
    historyBlock = `\n# Conversation history (for topic continuity)\n${lines}\n`;
  }

  return `${langDirective}${historyBlock}
# Current exchange (follow-up questions MUST be on THIS topic and language)
## User question (language = source of truth for follow-up language)
${question}

## Assistant answer (knowledge domain = source of truth for follow-up topic)
${truncatedAnswer}

# Task
Apply the system rules and output 3 follow-up questions, one per line.
Remember: drill into the answer's specifics, vary the angle, match the
user-question language.`;
}

function parseSuggestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Strip leading numbering / bullets the model may have leaked despite the prompt.
    .map((line) => line.replace(/^[\d).•\-*\s]+/, "").trim())
    .filter((line) => line.length > 0 && line.length <= 120)
    .slice(0, 3);
}

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

// Client feedback (item 34): the 3 suggested questions often led to "資料に
// 該当する情報がありません". Drop every suggestion the answer path would answer
// with a no-info fallback, so only answerable chips show.
//
// The answer path decides no-info in TWO places, so the check must too:
//   1. Retrieval gate - `out_of_kb` / zero results (app/api/rag/ask/route.ts).
//   2. LLM gate - Flash reads the retrieved chunks and, if they don't actually
//      address the question, emits the verbatim no-info line even though chunks
//      WERE retrieved (e.g. chunks USE "fiscal year" but never DEFINE it).
// A retrieval-only check (top_k/min_score) misses gate 2 entirely - that was
// the residual leak. So we prefilter on retrieval (cheap), then, for survivors,
// run the SAME model on the SAME chunks to mirror Flash's grounded judgment.
const HAS_KANA = /[぀-ヿ]/;

type RetrievedChunk = { text?: string };

// Retrieve exactly like the answer path: translate non-JP to Japanese first
// (the KB is Japanese, a raw non-JP query under-matches), min_score 0.42 /
// top_k 8. Returns null on any RAG error so the caller keeps the suggestion.
async function retrieveForSuggestion(
  suggestion: string,
  signal: AbortSignal,
): Promise<{ outOfKb: boolean; chunks: RetrievedChunk[] } | null> {
  const retrievalQuery = HAS_KANA.test(suggestion)
    ? undefined // already Japanese - retrieve as-is
    : await translateToJapanese(suggestion, signal);
  const res = await fetch(`${RAG_SERVICE_URL}/api/ai/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: suggestion,
      retrieval_query: retrievalQuery,
      top_k: 8,
      min_score: 0.42,
      filters: null,
    }),
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: RetrievedChunk[];
    out_of_kb?: boolean;
  };
  const chunks = Array.isArray(data.results) ? data.results : [];
  return { outOfKb: Boolean(data.out_of_kb), chunks };
}

// Gate 2: the same grounded no-info judgment the answer path's Flash makes.
// Feeds the top retrieved chunks and asks whether they DIRECTLY answer the
// question, with no outside knowledge - the same strict grounding. Returns true
// (answerable) on any error so a Flash outage never silently drops all chips.
// Bias toward NO_INFO on any doubt. The answer path's own no-info decision is
// slightly nondeterministic on borderline questions (the same model answers one
// call, refuses the next), so a symmetric judge would still leak on those. A
// suggestion chip that leads to a no-info reply is a worse experience than a
// missing chip, so we only KEEP a suggestion when the passages CLEARLY answer
// it and drop everything borderline.
const JUDGE_SYSTEM_PROMPT = `You judge whether an AI knowledge-base assistant could answer the QUESTION using ONLY the reference passages, with no outside knowledge and no inference - the same strict grounding the assistant uses. The passages must DIRECTLY and COMPLETELY address what the question asks: merely mentioning a term is NOT answering a request to define, explain, or give the value of it. Be strict: if the passages address the question only partially or indirectly, or if you are at all unsure, output NO_INFO. Output exactly one token: ANSWERABLE only when the passages clearly contain the answer, otherwise NO_INFO.`;

async function judgeAnswerable(
  suggestion: string,
  chunks: RetrievedChunk[],
  signal: AbortSignal,
): Promise<boolean> {
  const ctx = chunks
    .slice(0, 5)
    .map((c, i) => `[${i + 1}] ${typeof c.text === "string" ? c.text : ""}`)
    .join("\n---\n");
  try {
    const r = await generateFlashContent(
      `# 参考資料\n${ctx}\n\n# 質問\n${suggestion}`,
      {
        // Same model + thinking level as the answer path (app/api/rag/ask), so
        // this predicts its no-info decision instead of a lighter proxy.
        model: RAG_ANSWER_MODEL,
        thinkingLevel: "minimal",
        temperature: 0,
        maxOutputTokens: 512,
        systemInstruction: JUDGE_SYSTEM_PROMPT,
      },
      signal,
    );
    return !/NO_INFO/i.test(r.text);
  } catch {
    return true;
  }
}

async function keepAnswerable(
  suggestions: string[],
  signal: AbortSignal,
): Promise<string[]> {
  const checks = await Promise.all(
    suggestions.map(async (s): Promise<boolean> => {
      try {
        const retrieval = await retrieveForSuggestion(s, signal);
        if (retrieval === null) return true; // RAG error - keep gracefully
        // Gate 1 (cheap): no chunks -> the answer path emits no-info outright.
        if (retrieval.outOfKb || retrieval.chunks.length === 0) return false;
        // Gate 2 (LLM): chunks retrieved, but do they actually answer it?
        return await judgeAnswerable(s, retrieval.chunks, signal);
      } catch {
        return true;
      }
    }),
  );
  return suggestions.filter((_, i) => checks[i]);
}

export async function POST(req: Request): Promise<Response> {
  let payload: {
    question?: unknown;
    answer?: unknown;
    history?: unknown;
    lang?: unknown;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
  const lang = typeof payload.lang === "string" ? payload.lang : undefined;
  if (!question || !answer) {
    return NextResponse.json({ error: "Missing 'question' or 'answer'" }, { status: 400 });
  }
  // Optional conversation history - validate shape defensively.
  const history = Array.isArray(payload.history)
    ? (payload.history as Array<{ role?: unknown; text?: unknown }>)
        .filter(
          (m) =>
            (m.role === "user" || m.role === "model") &&
            typeof m.text === "string",
        )
        .map((m) => ({ role: m.role as "user" | "model", text: m.text as string }))
    : undefined;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ suggestions: generateDemoSuggestions(lang || "vi"), demo: true });
  }

  try {
    const flash = await generateFlashContent(
      buildUserPrompt(question, answer, history, lang),
      {
        model: SUGGESTIONS_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        maxOutputTokens: 1024,
        thinkingBudget: 512,
      },
      req.signal,
    );
    const suggestions = await keepAnswerable(parseSuggestions(flash.text), req.signal);
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    const isFlash = err instanceof FlashError;
    const status = isFlash ? (err.status ?? 502) : 502;
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== "production") {
      console.error("[/api/suggestions]", status, msg);
    }
    return NextResponse.json({ suggestions: generateDemoSuggestions(lang || "vi"), demo: true });
  }
}
