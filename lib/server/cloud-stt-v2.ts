/**
 * Server-side Google Cloud Speech-to-Text v2 client (Chirp + automatic
 * language detection) for the push-to-talk mic.
 *
 * Why v2 + sync Recognize instead of the v1 streaming bridge: the mic is
 * push-to-talk (short utterances), so we don't need real-time streaming. v1
 * streaming forced a single languageCode tied to the UI, which mis-transcribed
 * e.g. Japanese "こんにちは" as English "Konichiwa" when the UI was English.
 * Google's language auto-detection (`languageCodes:["auto"]`) does NOT work in
 * streaming, but it does in sync Recognize with the Chirp models - so we record
 * the whole clip and send ONE sync request, letting Chirp detect the spoken
 * language across all supported languages with no UI lock and no picker.
 *
 * Auth reuses the same service account as TTS (GOOGLE_TTS_SERVICE_ACCOUNT_*).
 * The v2 SpeechClient takes the parsed credentials directly.
 */

import "server-only";

import { readFile } from "node:fs/promises";
import { v2, protos } from "@google-cloud/speech";

// Chirp is regional. asia-southeast1 (Singapore) is the closest Chirp 2 region
// to the Japanese client, minimising round-trip latency. Override via env if a
// different region/model is ever needed (e.g. "us" + "chirp_3").
const LOCATION = process.env.STT_V2_LOCATION?.trim() || "asia-southeast1";
const MODEL = process.env.STT_V2_MODEL?.trim() || "chirp_2";

export class SttError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SttError";
  }
}

type ServiceAccount = { project_id?: string } & Record<string, unknown>;

async function loadServiceAccount(): Promise<ServiceAccount> {
  const filePath = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_FILE?.trim();
  let raw: string | null = null;
  if (filePath) {
    raw = await readFile(filePath, "utf-8");
  } else if (process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON?.trim()) {
    raw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON.trim();
  } else {
    const b64Raw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_BASE64?.trim();
    if (b64Raw) {
      // Accept wrapped/whitespace/newline values and base64url variants.
      const b64 = b64Raw
        .replace(/^['"]|['"]$/g, "")
        .replace(/\s+/g, "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      raw = Buffer.from(b64, "base64").toString("utf-8");
    }
  }
  if (!raw) {
    throw new SttError(
      "GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 (or _JSON/_FILE) not configured",
    );
  }
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new SttError("Service account JSON is invalid");
  }
}

// Reuse one client (and its gRPC channel) across requests.
let cachedClient: v2.SpeechClient | null = null;
let cachedProjectId: string | null = null;

async function getClient(): Promise<{ client: v2.SpeechClient; projectId: string }> {
  if (cachedClient && cachedProjectId) {
    return { client: cachedClient, projectId: cachedProjectId };
  }
  const creds = await loadServiceAccount();
  const projectId = creds.project_id;
  if (!projectId) {
    throw new SttError("Service account JSON has no project_id");
  }
  cachedClient = new v2.SpeechClient({
    credentials: creds,
    projectId,
    apiEndpoint: `${LOCATION}-speech.googleapis.com`,
  });
  cachedProjectId = projectId;
  return { client: cachedClient, projectId };
}

// Chirp tokenises CJK output with spaces ("こんにちは 。 今日 は ..."). Collapse
// spaces that sit between two CJK/kana characters so the transcript reads
// naturally; spaces around Latin words are left intact.
// Hiragana/katakana/kanji ranges plus CJK punctuation (、-〿: 、。「」
// etc.) so a space sitting AFTER a Japanese full stop also collapses ("。 今"
// -> "。今"), not just spaces between two letters.
const CJK = "\\u3001-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff66-\\uff9f";
const CJK_SPACE_RE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "g");

function cleanupTranscript(text: string): string {
  let out = text;
  // Run twice: a single pass misses runs of single-char tokens ("今 日 は").
  out = out.replace(CJK_SPACE_RE, "$1").replace(CJK_SPACE_RE, "$1");
  // Drop a space before CJK punctuation (" 。" -> "。").
  out = out.replace(/\s+([、。！？」』）])/g, "$1");
  return out.trim();
}

export type Transcription = { text: string; lang: string };

/**
 * Transcribe a recorded audio clip with Chirp + automatic language detection.
 * `audio` is the raw bytes of a browser-recorded container (webm/opus, ogg/opus)
 * - v2 `autoDecodingConfig` detects the format, so no sample rate is needed.
 */
export async function transcribeAudio(audio: Buffer): Promise<Transcription> {
  if (audio.length === 0) return { text: "", lang: "" };

  const { client, projectId } = await getClient();
  const request: protos.google.cloud.speech.v2.IRecognizeRequest = {
    recognizer: `projects/${projectId}/locations/${LOCATION}/recognizers/_`,
    config: {
      autoDecodingConfig: {},
      languageCodes: ["auto"],
      model: MODEL,
      features: { enableAutomaticPunctuation: true },
    },
    content: audio,
  };

  let response: protos.google.cloud.speech.v2.IRecognizeResponse;
  try {
    [response] = await client.recognize(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SttError(`STT recognize failed: ${msg}`);
  }

  const results = response.results ?? [];
  const text = cleanupTranscript(
    results.map((r) => r.alternatives?.[0]?.transcript ?? "").join(" "),
  );
  const lang = results.map((r) => r.languageCode).find(Boolean) ?? "";
  return { text, lang };
}
