/**
 * Server-side Gemini Flash REST client. Mirrors Unity
 * `GeminiFlashConnector.cs`: text-only `generateContent` call with retry on
 * 5xx / 429, returns the assistant's full answer in one shot.
 *
 * This file imports nothing browser-y and lives under `lib/server/*` so it
 * is impossible to accidentally bundle the API key into client code.
 */

import "server-only";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const STREAM_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.3;
// Sized for `gemini-2.5-flash` where the "thinking" budget defaults to auto
// and can eat 1k-2k tokens BEFORE any answer is emitted. 2048 was enough for
// short JP answers but English (more tokens per word) was getting truncated
// mid-bullet on long policy questions. 4096 leaves ~2k for the answer after
// thinking overhead, comfortable for any language under the 500-char rule.
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 1_000, 3_000];

export type FlashUsage = {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
};

export type FlashResult = {
  text: string;
  usage: FlashUsage;
};

export type FlashOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  /**
   * Gemini 2.5 Flash "thinking" budget. Defaults to model auto-pick which
   * can eat the entire `maxOutputTokens` for short prompts (e.g. nod, 40
   * tokens) leaving no room for the actual reply. Set to 0 to disable
   * thinking entirely.
   */
  thinkingBudget?: number;
  /**
   * Gemini 3.x "thinking level" (minimal | low | medium | high). Mutually
   * exclusive with `thinkingBudget` - the API returns 400 if both are set, so
   * when this is provided it wins. The gemini-3.5-flash RAG path uses
   * "minimal": on clean retrieved context it matches 2.5-flash+2048 accuracy
   * at roughly half the latency (validated 2026-06-09).
   */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export class FlashError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FlashError";
  }
}

export async function generateFlashContent(
  userPrompt: string,
  options: FlashOptions = {},
  signal?: AbortSignal,
): Promise<FlashResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new FlashError("GEMINI_API_KEY not configured");

  const model = options.model ?? DEFAULT_MODEL;
  const url = `${ENDPOINT.replace("{model}", model)}?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    responseModalities: ["TEXT"],
  };
  if (options.thinkingLevel !== undefined) {
    // thinkingLevel (3.x) and thinkingBudget (2.5) are mutually exclusive -
    // sending both 400s. Prefer the level when set.
    generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  } else if (options.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig,
  };
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (RETRYABLE_STATUSES.has(res.status) && attempt < RETRY_DELAYS_MS.length - 1) {
          lastError = new FlashError(
            `Flash ${res.status}: ${errText.slice(0, 200)}`,
            res.status,
          );
          continue;
        }
        throw new FlashError(
          `Flash ${res.status}: ${errText.slice(0, 200)}`,
          res.status,
        );
      }

      const json = (await res.json()) as GeminiResponse;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const finishReason = json.candidates?.[0]?.finishReason;
      // Surface MAX_TOKENS so the next time an answer is cut mid-sentence we
      // know it's the cap, not a streaming or display bug. Production logs
      // are fine - this is a server route.
      if (finishReason === "MAX_TOKENS") {
        console.warn(
          `[gemini-flash] truncated at MAX_TOKENS (model=${model}, max=${generationConfig.maxOutputTokens}, candidateTokens=${json.usageMetadata?.candidatesTokenCount ?? "?"})`,
        );
      }
      const usage: FlashUsage = {
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        candidateTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
      };
      return { text, usage };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      // Network failures: only retry if attempts remain.
      if (attempt >= RETRY_DELAYS_MS.length - 1) throw lastError;
    }
  }

  throw lastError ?? new FlashError("Flash request failed (unknown)");
}

/**
 * Streaming variant that yields text deltas as Flash emits them. Hits the
 * `:streamGenerateContent?alt=sse` endpoint and parses Server-Sent Events.
 *
 * We retry the INITIAL connection on 429/5xx (incl. the "high demand" 503
 * that was the dominant cause of the client's "ナレッジベースへの問い合わせに
 * 失敗しました" - #11/#28/#39). That retry is safe because no delta has been
 * yielded yet, so there is nothing to replay. Once streaming has started we
 * do NOT retry - the answer would have to replay from scratch and consumers
 * may already have queued audio for the first sentences.
 */
export async function* streamFlashContent(
  userPrompt: string,
  options: FlashOptions = {},
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new FlashError("GEMINI_API_KEY not configured");

  const model = options.model ?? DEFAULT_MODEL;
  const url = `${STREAM_ENDPOINT.replace("{model}", model)}&key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    responseModalities: ["TEXT"],
  };
  if (options.thinkingLevel !== undefined) {
    // thinkingLevel (3.x) and thinkingBudget (2.5) are mutually exclusive -
    // sending both 400s. Prefer the level when set.
    generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  } else if (options.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig,
  };
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  // Retry the initial connect on transient failures (429/5xx incl. the
  // "high demand" 503). Safe here because nothing has been yielded yet.
  let res: Response | undefined;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      // Network-level failure: retry while attempts remain.
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (r.ok) {
      res = r;
      break;
    }
    const errText = await r.text().catch(() => "");
    lastError = new FlashError(
      `Flash stream ${r.status}: ${errText.slice(0, 200)}`,
      r.status,
    );
    // 4xx (bad request, auth) will never succeed on retry - fail fast.
    if (!RETRYABLE_STATUSES.has(r.status)) throw lastError;
    // Retryable status: fall through; the loop retries if attempts remain.
  }
  if (!res) {
    throw lastError ?? new FlashError("Flash stream failed (unknown)");
  }
  if (!res.body) throw new FlashError("Flash stream returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Each SSE event arrives as `data: {...}\r\n\r\n` (Gemini uses CRLF). We
  // normalise to LF here and split on the LF blank-line boundary; boundaries
  // can also land mid-event across `read()` calls so accumulate first.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = rawEvent
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let parsed: GeminiResponse;
      try {
        parsed = JSON.parse(payload) as GeminiResponse;
      } catch {
        continue;
      }
      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (p.text) yield p.text;
      }
      const finishReason = parsed.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn(
          `[gemini-flash] stream truncated at MAX_TOKENS (model=${model}, max=${generationConfig.maxOutputTokens})`,
        );
      }
    }
  }
}
