import { NextResponse } from "next/server";

import { citationsFromChunks } from "@/lib/citations";
import { detectLangConfident, sttLangToSupported } from "@/lib/lang-detect";
import type { RagAskMeta } from "@/lib/rag-ask";
import {
  buildGroundedPrompt,
  OUT_OF_KB_MSGS,
  RAG_SYSTEM_PROMPT,
  type RagChunk,
  type RagHistoryTurn,
  type RagQueryResponse,
} from "@/lib/rag-client";
import { getActiveAssistant } from "@/lib/server/active-assistant";
import { searchDemoKnowledgeBase } from "@/lib/server/demo-chat";
import { getIngestDateMap } from "@/lib/server/file-resolve";
import { FlashError, streamFlashContent } from "@/lib/server/gemini-flash";
import { RAG_ANSWER_MODEL } from "@/lib/server/models";
import { translateToJapanese } from "@/lib/server/translate-jp";

// Tell Next.js this is a streamed response - prevents dev-mode buffering
// that would hold every `delta` event back until the stream completes,
// defeating the whole point of D2.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RAG orchestrator endpoint. Mirrors Unity `RAGOrchestratorV2.AskAsync()`:
 *   1. Hit the local rag-service for top-k chunks.
 *   2. If `out_of_kb`, emit a fallback message (no Flash call).
 *   3. Build grounded prompt, stream Gemini Flash deltas to the client.
 *
 * Response is a Server-Sent Events stream so the chat bubble can fill in as
 * tokens arrive and the client can start TTS on the first complete sentence
 * (~1-2 s in) instead of waiting for the full Flash response (~5-6 s).
 *
 * Event sequence:
 *   - `meta`  { citations, outOfKb, answerLang? } - sent before any answer text.
 *   - `delta` { text }                 - one or more, the streamed answer.
 *   - `error` { message }              - only on hard failure.
 *   - `done`  {}                       - terminator.
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

// Kana (hiragana + katakana) = a definitive "this text is Japanese" signal,
// used to decide whether the query needs translating for retrieval.
const HAS_KANA = /[぀-ヿ]/;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  let payload: {
    query?: unknown;
    topK?: unknown;
    minScore?: unknown;
    history?: unknown;
    langHint?: unknown;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }
  const query = payload.query.trim();
  const topK = typeof payload.topK === "number" ? payload.topK : 8;
  // Lowered 0.5 → 0.42: translation-assisted retrieval now closes most of
  // the cross-lingual embedding gap, so we can accept slightly weaker dense
  // matches without introducing noise.  The updated system prompt handles
  // "related but not exact" chunks by explaining the topic rather than
  // returning "no info" — so borderline chunks are now useful, not just noise.
  const minScore = typeof payload.minScore === "number" ? payload.minScore : 0.42;
  // Conversation history (last N turns) for anaphora resolution in the Flash
  // prompt only. Retrieval still embeds the raw query so chunk ranking does
  // not drift when history is included. Validate shape defensively.
  const history: RagHistoryTurn[] = Array.isArray(payload.history)
    ? (payload.history as Array<{ role?: unknown; text?: unknown }>)
        .filter(
          (m) =>
            (m.role === "user" || m.role === "model") &&
            typeof m.text === "string" &&
            (m.text as string).trim().length > 0,
        )
        .map((m) => ({ role: m.role as "user" | "model", text: m.text as string }))
    : [];

  // Only augment embedQuery with history when the question is a contextual
  // follow-up (contains a pronoun/anaphor/demonstrative referring to prior
  // context). Standalone questions like "就業時間を教えください" are
  // self-contained — augmenting them changes the embedding every turn so the
  // same question retrieves different chunks on repeated asks.
  const FOLLOWUP_HINT =
    /それ|この|その|あの|前述|上記|同じ|同様|先ほど|さっき|その件|その点|その方法|\bit\b|\bthis\b|\bthat\b|\bthese\b|\bthose\b|\bthey\b|\bthem\b/i;
  let embedQuery = query;
  if (history.length > 0 && query.length <= 100 && FOLLOWUP_HINT.test(query)) {
    const lastUserTurn = [...history].reverse().find((m) => m.role === "user");
    if (lastUserTurn) {
      const ctx =
        lastUserTurn.text.length > 200
          ? lastUserTurn.text.slice(0, 200)
          : lastUserTurn.text;
      embedQuery = `${ctx} ${query}`;
    }
  }

  // A client hint identifies the recognized speech or the current input's
  // language, with the UI preference resolving ambiguous Latin text.
  const langHint =
    typeof payload.langHint === "string"
      ? sttLangToSupported(payload.langHint)
      : null;

  // Detect user language once — reused for retrieval translation, outOfKb
  // fallback text, and the grounded-prompt language tag.
  const detection = langHint
    ? { lang: langHint, confident: true }
    : detectLangConfident(query);
  const queryLang = detection.lang;

  const streamDemoAnswer = () => {
    const { answer, answerLang, citations, outOfKb } = searchDemoKnowledgeBase(query, queryLang);
    const encoder = new TextEncoder();
    const demoStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        };
        send("meta", { citations, outOfKb, answerLang } satisfies RagAskMeta);
        // Stream in smooth small chunks so the typing effect feels natural
        const parts = answer.match(/\S+\s*/g) ?? [answer];
        for (const chunk of parts) {
          if (req.signal.aborted) break;
          send("delta", { text: chunk });
          await new Promise<void>((r) => setTimeout(r, 18));
        }
        send("done", {});
        controller.close();
      },
    });
    return new Response(demoStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  };

  if (!process.env.GEMINI_API_KEY) {
    return streamDemoAnswer();
  }

  // Read persona and ingest dates in parallel with live retrieval.
  const assistantPromise = getActiveAssistant().catch(() => null);
  const ingestDatesPromise = getIngestDateMap().catch(() => undefined);

  // The KB is primarily Japanese. Translate for retrieval based on whether
  // the query contains kana. The answer still receives the original query.
  const queryIsJapanese = HAS_KANA.test(embedQuery);
  const retrievalQuery = queryIsJapanese
    ? undefined // undefined is stripped by JSON.stringify
    : await translateToJapanese(embedQuery, req.signal);

  const RAG_BODY = {
    query: embedQuery,
    retrieval_query: retrievalQuery,
    top_k: topK,
    min_score: minScore,
    filters: null,
  };
  let ragResult: RagQueryResponse;
  try {
    let lastStatus = 0;
    let lastText = "";
    let ragRes: Response | null = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (req.signal.aborted) break;
      try {
        const attemptSignal = AbortSignal.any
          ? AbortSignal.any([req.signal, AbortSignal.timeout(3_000)])
          : req.signal;
        ragRes = await fetch(`${RAG_SERVICE_URL}/api/ai/query`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(RAG_BODY),
          signal: attemptSignal,
        });
        lastStatus = ragRes.status;
        if (ragRes.ok) break; // success
        if (ragRes.status < 500) break; // 4xx — don't retry
        lastText = await ragRes.text().catch(() => "");
        ragRes = null; // mark as failed for retry
      } catch (fetchErr) {
        if (fetchErr instanceof Error && fetchErr.name === "AbortError") throw fetchErr;
        lastText = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      }
      if (attempt < 1) {
        await new Promise<void>((r) => setTimeout(r, 200));
      } else {
        break;
      }
    }
    if (!ragRes || !ragRes.ok) {
      console.warn("[/api/rag/ask] upstream unavailable, using local demo KB:", lastStatus, lastText.slice(0, 120));
      return streamDemoAnswer();
    }
    ragResult = (await ragRes.json()) as RagQueryResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    console.warn("[/api/rag/ask] upstream failed, using local demo KB:", err);
    return streamDemoAnswer();
  }

  const outOfKb =
    ragResult.out_of_kb || ragResult.results.length === 0;
  const citations = outOfKb
    ? []
    : citationsFromChunks(ragResult.results as RagChunk[]);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        send("meta", { citations, outOfKb } satisfies RagAskMeta);

        if (outOfKb) {
          send("delta", { text: OUT_OF_KB_MSGS[queryLang] ?? OUT_OF_KB_MSGS.ja });
          send("done", {});
          controller.close();
          return;
        }

        // Both reads were started before retrieval; await them here (already
        // resolved in the common case). KB ingest dates let "最新のデータはいつ"
        // answer with the registration date, not a date inside the document.
        const [assistant, ingestDates] = await Promise.all([
          assistantPromise,
          ingestDatesPromise,
        ]);

        const userPrompt = buildGroundedPrompt(
          query,
          ragResult.results as RagChunk[],
          history,
          queryLang,
          ingestDates,
          detection.confident,
        );

        // Append admin-managed persona/stance AFTER the hardcoded RAG rules
        // so it acts as a tone override. Grounding rules in RAG_SYSTEM_PROMPT
        // still come first as the baseline; the override block can change
        // voice/tone but is instructed below to leave grounding intact.
        const systemInstruction = assistant?.system_instruction
          ? `${RAG_SYSTEM_PROMPT}\n\n# Session persona and active stance\nUse these settings for tone and persona. Preserve citations, grounding, and factual content.\n\n${assistant.system_instruction}\n\nFollow the current question's reply-language instruction above all persona, stance, and conversation-history language preferences.`
          : RAG_SYSTEM_PROMPT;

        for await (const delta of streamFlashContent(
          userPrompt,
          {
            // gemini-3.5-flash (GA, not the preview we reverted 2026-05-28):
            // Pro-grade reasoning at Flash latency. With thinkingLevel "minimal"
            // it answers tiered-allowance/calc questions (出張 N泊, 残業, 有給)
            // correctly AND ~2x faster than 2.5-flash+2048 (validated 2026-06-09
            // on clean re-ingested chunks).
            //
            // TRIED gemini-3.1-flash-lite 2026-06-10 (faster + cheaper): it
            // matched flash on CLEAN constructed chunks (calc, adherence 5/5,
            // no-info) but REGRESSED on a REAL retrieved chunk - for "道外3泊"
            // off the actual 労務規定 PDF it listed 6,000+3,000+3,000 then stated
            // the total as 9,000 (flash gives 12,000, reproducibly, same chunk +
            // route). A wrong number on a live demo query is unacceptable, so we
            // keep flash. Lite's weakness is real-chunk arithmetic, the same
            // class minimal-on-noisy showed. (e:/tmp/calc_decisive.mjs et al.)
            // Overridable via RAG_ANSWER_MODEL (see lib/server/models.ts).
            model: RAG_ANSWER_MODEL,
            systemInstruction,
            // "minimal" thinking: enough reasoning for the document's tiered
            // allowance structure without the multi-second thinking tax.
            thinkingLevel: "minimal",
            // Pin to greedy decoding: this is a grounded KB assistant, so the
            // same question over the same chunks must give the same answer.
            // The default 0.3 let repeated identical asks drift in wording and
            // occasionally in which facts were surfaced (#1/#2). Retrieval is
            // already deterministic (stable embedQuery); this closes the gap.
            temperature: 0,
          },
          req.signal,
        )) {
          send("delta", { text: delta });
        }

        send("done", {});
        controller.close();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          controller.close();
          return;
        }
        const isFlash = err instanceof FlashError;
        const status = isFlash ? (err.status ?? 502) : 502;
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { message: msg, status });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tell intermediaries (Next, Cloud Run, etc.) not to buffer the stream.
      "x-accel-buffering": "no",
    },
  });
}
