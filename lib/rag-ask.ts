import type { Citation } from "@/lib/citations";
import type { RagChunk } from "@/lib/rag-client";
import { sttLangToSupported, type SupportedLang } from "./lang-detect";

/**
 * Client wrapper for `/api/rag/ask`. The endpoint streams Server-Sent Events
 * so the chat bubble can fill in incrementally and TTS can start on the
 * first complete sentence; `askRag` aggregates the stream into the same
 * one-shot shape the previous (non-streaming) version exposed, while
 * `askRagStream` is the lower-level API for the live UI path.
 */

export type RagAskResult = {
  answer: string;
  citations: Citation[];
  outOfKb: boolean;
};

export type RagAskMeta = {
  citations: Citation[];
  outOfKb: boolean;
  /** Known language of a prewritten answer, sent before the first text delta. */
  answerLang?: SupportedLang;
};

export type RagStreamCallbacks = {
  /** Metadata sent once before any delta. */
  onMeta?: (meta: RagAskMeta) => void;
  /** A text delta from the model. May arrive many times. */
  onDelta?: (text: string) => void;
};

export class RagAskError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RagAskError";
  }
}

/**
 * Stream the grounded answer from `/api/rag/ask`. Invokes `onMeta` once with
 * citations + outOfKb, then `onDelta` repeatedly with text fragments. Resolves
 * with the aggregated result once the stream's `done` event arrives.
 */
export async function askRagStream(
  query: string,
  callbacks: RagStreamCallbacks,
  signal?: AbortSignal,
  history?: Array<{ role: "user" | "model"; text: string }>,
  langHint?: string | null,
): Promise<RagAskResult> {
  const res = await fetch("/api/rag/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, history, langHint }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RagAskError(
      `RAG ask failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  }
  if (!res.body) {
    throw new RagAskError("RAG ask returned no body", res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let answer = "";
  let citations: Citation[] = [];
  let outOfKb = false;
  let serverError: { message: string; status?: number } | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CR-LF -> LF in case anything in the chain (Next dev, a
      // reverse proxy) emits CRLF-separated events.
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = "message";
        let dataLine = "";
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLine = line.slice(6);
        }
        if (!dataLine) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (event === "meta") {
          const m = parsed as { citations?: Citation[]; outOfKb?: boolean; answerLang?: unknown };
          citations = m.citations ?? [];
          outOfKb = !!m.outOfKb;
          const answerLang = typeof m.answerLang === "string" ? sttLangToSupported(m.answerLang) ?? undefined : undefined;
          callbacks.onMeta?.({ citations, outOfKb, answerLang });
        } else if (event === "delta") {
          const d = parsed as { text?: string };
          if (typeof d.text === "string" && d.text.length > 0) {
            answer += d.text;
            callbacks.onDelta?.(d.text);
          }
        } else if (event === "error") {
          serverError = parsed as { message: string; status?: number };
        }
        // "done" event is the terminator - the read loop exits on the next
        // read returning done=true.
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (serverError) {
    throw new RagAskError(serverError.message, serverError.status);
  }

  return { answer, citations, outOfKb };
}

/**
 * One-shot wrapper preserved for the voice debounce path (still callable
 * the same way as before). Internally consumes the same stream.
 */
export async function askRag(
  query: string,
  signal?: AbortSignal,
  history?: Array<{ role: "user" | "model"; text: string }>,
): Promise<RagAskResult> {
  return askRagStream(query, {}, signal, history);
}

export type RetrieveResult = {
  chunks: RagChunk[];
  citations: Citation[];
  outOfKb: boolean;
};

/**
 * Chunks-only retrieval (no Flash answer). Used by the voice path which
 * feeds the chunks back into Gemini Live for a native-audio grounded reply.
 */
export async function retrieveChunks(
  query: string,
  signal?: AbortSignal,
): Promise<RetrieveResult> {
  const res = await fetch("/api/rag/retrieve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RagAskError(
      `Retrieve failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  }
  return (await res.json()) as RetrieveResult;
}

/**
 * Decide whether to route the question to RAG ("KB") or let Gemini Live
 * answer it conversationally ("CHAT"). Fails open to "KB" on any error so a
 * classifier outage never strips retrieval from a real KB question.
 */
export async function classifyKb(
  query: string,
  signal?: AbortSignal,
  history?: Array<{ role: "user" | "model"; text: string }>,
): Promise<"KB" | "CHAT"> {
  try {
    const res = await fetch("/api/classify-kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, history }),
      signal,
    });
    if (!res.ok) return "KB";
    const json = (await res.json()) as { decision?: string };
    const decision = json.decision === "CHAT" ? "CHAT" : "KB";
    console.log("[classifyKb]", JSON.stringify(query), "→", decision);
    return decision;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return "KB";
  }
}

/**
 * Fire a Nod (aizuchi) request - short acknowledgement filler shown while
 * the real RAG answer is still being retrieved. Returns the empty string if
 * the model produced nothing usable; caller should treat that as "skip".
 */
export async function askNod(
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/nod", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RagAskError(
      `Nod ask failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/**
 * Ask the server for 3 follow-up question suggestions grounded in the last
 * Q+A. Returns an empty array on any failure - suggestions are decorative.
 *
 * `history` (optional) is the last N {role, text} turns so the model can
 * propose follow-ups that continue the full dialogue thread, not just the
 * last Q+A. The hook builds this via `chat.getRecentHistory(N)`.
 */
export async function askSuggestions(
  question: string,
  answer: string,
  signal?: AbortSignal,
  history?: Array<{ role: "user" | "model"; text: string }>,
  lang?: string,
): Promise<string[]> {
  try {
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, answer, history, lang }),
      signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { suggestions?: unknown };
    return Array.isArray(json.suggestions)
      ? json.suggestions.filter((s): s is string => typeof s === "string")
      : [];
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return [];
  }
}

export type TtsVoiceOpts = {
  /** Cloud TTS voice id, e.g. "en-US-Neural2-F". */
  voice?: string;
  /** Cloud TTS language code, e.g. "en-US". */
  languageCode?: string;
  /** Avatar gender - routes the Fish Audio JP voice to a male/female model. */
  gender?: "female" | "male";
};

/**
 * Synthesise a single sentence -> raw PCM bytes (LINEAR16 24kHz). Throws
 * on non-2xx responses. Designed to be launched in parallel by the caller.
 *
 * `opts.voice` / `opts.languageCode` let the caller route Japanese answers
 * to the Japanese Neural2 voice, English to en-US, etc. - otherwise the TTS
 * route falls back to its server-side default (ja-JP-Neural2-B).
 */
export async function synthesiseSentence(
  text: string,
  signal?: AbortSignal,
  opts: TtsVoiceOpts = {},
): Promise<Uint8Array> {
  const res = await fetch("/api/tts/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...opts }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new RagAskError(
      `TTS failed: ${res.status} ${errText.slice(0, 200)}`,
      res.status,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Streaming counterpart to {@link synthesiseSentence}: fires the same
 * request but resolves as soon as headers arrive, leaving the body unread so
 * the caller can pipe PCM chunks to the player as they land (see
 * {@link pumpPcmResponse}). Same one-request-per-batch contract - this is
 * ONE fetch, just read incrementally instead of buffered whole.
 */
export async function synthesiseSentenceStream(
  text: string,
  signal?: AbortSignal,
  opts: TtsVoiceOpts = {},
): Promise<Response> {
  const res = await fetch("/api/tts/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...opts }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new RagAskError(
      `TTS failed: ${res.status} ${errText.slice(0, 200)}`,
      res.status,
    );
  }
  return res;
}

/**
 * Read a `/api/tts/synthesize` response incrementally and hand each
 * even-length PCM slice to `onChunk` as it arrives, carrying any odd
 * trailing byte over to the next read (PCM16 samples are 2 bytes; a chunk
 * boundary can split a sample in half). The Fish branch of the route streams
 * progressively (first byte ~320ms in); the Azure/Google branches return a
 * single buffered chunk, so this same read loop just sees one chunk for
 * those - one code path either way.
 *
 * `onChunk`'s second argument is the fade envelope for the player: `in` is
 * true only for the FIRST slice of this response (masks the seam with the
 * previous batch / start-after-silence), `out` is true only for the LAST
 * slice (masks the seam to the next batch, whose endpoint samples aren't
 * exactly zero). Middle slices carry neither - they are contiguous samples of
 * ONE take and fading them would dip the voice. To tag the last slice we hold
 * the most recent one back by one read and flush it when the stream ends.
 *
 * Cancels the underlying reader (and stops calling `onChunk`) once `signal`
 * aborts, so a skipped/interrupted turn doesn't keep pushing audio.
 */
export async function pumpPcmResponse(
  res: Response,
  signal: AbortSignal,
  onChunk: (pcm: Uint8Array, fade: { in: boolean; out: boolean }) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal.aborted) {
    onAbort();
    return;
  }
  signal.addEventListener("abort", onAbort, { once: true });

  // Explicit `Uint8Array` (not inferred) so the variable keeps the default
  // `ArrayBufferLike` generic - `new Uint8Array(n)` alone infers the narrower
  // `Uint8Array<ArrayBuffer>`, which then rejects the `ArrayBufferLike`-typed
  // view `reader.read()` hands back.
  let leftover: Uint8Array = new Uint8Array(0);
  // Held-back slice so the LAST one can be flagged fade.out (only known once
  // the following read returns done).
  let pending: Uint8Array | null = null;
  let pendingFirst = false;
  let seenAny = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      if (!value || value.length === 0) continue;

      let chunk: Uint8Array;
      if (leftover.length > 0) {
        chunk = new Uint8Array(leftover.length + value.length);
        chunk.set(leftover, 0);
        chunk.set(value, leftover.length);
      } else {
        chunk = value;
      }

      // Keep the slice 16-bit-sample-aligned; carry a trailing odd byte to
      // the next read instead of feeding pcm16ToFloat a half sample.
      const evenLen = chunk.length - (chunk.length % 2);
      if (evenLen > 0) {
        const aligned = chunk.subarray(0, evenLen);
        if (pending) onChunk(pending, { in: pendingFirst, out: false });
        pending = aligned;
        pendingFirst = !seenAny;
        seenAny = true;
      }
      leftover = chunk.subarray(evenLen);
    }
    // Flush the final held slice with fade.out - unless the turn was aborted
    // mid-stream (the player is cleared elsewhere on abort). A single-slice
    // response gets both in+out here, matching a fully-buffered utterance.
    if (pending && !signal.aborted) {
      onChunk(pending, { in: pendingFirst, out: true });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
