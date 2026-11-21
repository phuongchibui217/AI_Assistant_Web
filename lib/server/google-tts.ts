/**
 * Server-side Google Cloud Text-to-Speech REST client. Mirrors Unity
 * `GoogleCloudTtsConnector.cs`: synthesize JP/EN/VN text to LINEAR16 mono PCM
 * at 24 kHz, ready to be streamed into the same `AudioStreamPlayer` queue the
 * client already uses for Gemini Live audio.
 *
 * Auth: API key is read from `GOOGLE_TTS_API_KEY` if set, otherwise falls
 * back to `GEMINI_API_KEY` (same Google Cloud project commonly has both APIs
 * enabled).
 */

import "server-only";

import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";

const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

const DEFAULT_VOICE = "ja-JP-Neural2-B";
const DEFAULT_SAMPLE_RATE = 24_000;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 750, 2_000];

export type TtsOptions = {
  voice?: string;
  /** Override language code; usually inferred from voice name prefix. */
  languageCode?: string;
  /** Output sample rate (24kHz matches the Live player and Unity default). */
  sampleRateHertz?: number;
  speakingRate?: number;
  pitch?: number;
  /** If true, `text` is sent as SSML markup instead of plain text. The
   *  caller is responsible for wrapping in `<speak>...</speak>` and
   *  escaping any special characters in non-tag spans. */
  ssml?: boolean;
};

export class TtsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TtsError";
  }
}

type TtsResponse = { audioContent?: string };

type OAuthCache = {
  token: string;
  expiresAt: number;
};

let oauthCache: OAuthCache | null = null;

function inferLanguageCode(voice: string): string {
  // Voice names look like "ja-JP-Neural2-B" - first two segments are the lang.
  const parts = voice.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "ja-JP";
}

function getApiKey(): string {
  const key = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new TtsError("GOOGLE_TTS_API_KEY (or GEMINI_API_KEY) not configured");
  }
  return key;
}

async function getServiceAccountJson(): Promise<string | null> {
  const filePath = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_FILE?.trim();
  if (filePath) {
    const raw = await readFile(filePath, "utf-8");
    return raw;
  }
  const inline = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;
  const b64Raw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_BASE64?.trim();
  if (!b64Raw) return null;
  try {
    // Accept wrapped/whitespace/newline env values and base64url variants.
    const b64 = b64Raw
      .replace(/^['"]|['"]$/g, "")
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    throw new TtsError("GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 is not valid base64");
  }
}

async function getAuthHeader(): Promise<string | null> {
  const rawJson = await getServiceAccountJson();
  if (!rawJson) return null;

  const now = Date.now();
  if (oauthCache && oauthCache.expiresAt > now + 60_000) {
    return `Bearer ${oauthCache.token}`;
  }

  let credentials: object;
  try {
    credentials = JSON.parse(rawJson) as object;
  } catch {
    throw new TtsError(
      "Service account JSON is invalid (check GOOGLE_TTS_SERVICE_ACCOUNT_JSON/BASE64)",
    );
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const tokenClient = await auth.getClient();
  const tokenRes = await tokenClient.getAccessToken();
  const token = tokenRes.token;
  if (!token) {
    throw new TtsError("Could not obtain access token from service account");
  }

  // Access tokens are usually 1h. Keep a conservative 50-min cache.
  oauthCache = { token, expiresAt: now + 50 * 60_000 };
  return `Bearer ${token}`;
}

/**
 * Synthesize text -> raw PCM bytes (LINEAR16 mono at the configured rate).
 * The Google REST API returns base64; we decode it once and hand the bytes
 * back so the API route can stream them as `application/octet-stream`.
 */
export async function synthesizeSpeech(
  text: string,
  options: TtsOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!text.trim()) return new Uint8Array(0);

  const voice = options.voice ?? DEFAULT_VOICE;
  const languageCode = options.languageCode ?? inferLanguageCode(voice);
  const sampleRate = options.sampleRateHertz ?? DEFAULT_SAMPLE_RATE;

  const body: Record<string, unknown> = {
    input: options.ssml ? { ssml: text } : { text },
    voice: { languageCode, name: voice },
    audioConfig: {
      audioEncoding: "LINEAR16",
      sampleRateHertz: sampleRate,
    },
  };
  if (options.speakingRate !== undefined) {
    (body.audioConfig as Record<string, unknown>).speakingRate = options.speakingRate;
  }
  if (options.pitch !== undefined) {
    (body.audioConfig as Record<string, unknown>).pitch = options.pitch;
  }

  const authHeader = await getAuthHeader();
  const url = authHeader ? ENDPOINT : `${ENDPOINT}?key=${getApiKey()}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authHeader) headers.authorization = authHeader;
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
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (RETRYABLE_STATUSES.has(res.status) && attempt < RETRY_DELAYS_MS.length - 1) {
          lastError = new TtsError(
            `TTS ${res.status}: ${errText.slice(0, 200)}`,
            res.status,
          );
          continue;
        }
        throw new TtsError(
          `TTS ${res.status}: ${errText.slice(0, 200)}`,
          res.status,
        );
      }

      const json = (await res.json()) as TtsResponse;
      if (!json.audioContent) {
        throw new TtsError("TTS response missing audioContent");
      }
      // Buffer here is the Node global - this is a server-only module.
      return new Uint8Array(Buffer.from(json.audioContent, "base64"));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= RETRY_DELAYS_MS.length - 1) throw lastError;
    }
  }

  throw lastError ?? new TtsError("TTS request failed (unknown)");
}
