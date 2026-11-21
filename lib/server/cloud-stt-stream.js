// @ts-check
/**
 * Browser WS <-> Google Cloud Speech-to-Text **v2 streaming** bridge (案1).
 *
 * Why a second bridge instead of extending cloud-stt-bridge.js (v1): v1
 * streaming forces ONE languageCode, which mis-transcribed e.g. Japanese as
 * romaji when the UI was English - the exact reason the web mic moved to v2
 * sync Recognize. The POC (2026-07-15) proved v2 streaming with the `long`
 * model + an EXPLICIT list of language codes gives BOTH real-time interim
 * results AND correct language auto-detection within that set. This bridge
 * ports that finding so the mic can stream the transcript into the input box
 * as the user speaks (案1), while keeping the language correct.
 *
 * v1 bridge (`/ws/stt`) + sync `/api/stt` stay as fallbacks - untouched.
 *
 * Protocol (browser -> server):
 *   - JSON  {type:"start"}      open the recognise stream
 *   - Binary frames             raw LINEAR16 mono PCM @ 16 kHz (little-endian)
 *   - JSON  {type:"stop"}       finish the stream (half-close the write side)
 *
 * Protocol (server -> browser):
 *   - JSON  {type:"ready"}                        Cloud stream open, send audio
 *   - JSON  {type:"transcript", text, isFinal, lang}
 *   - JSON  {type:"error", message}
 *   - JSON  {type:"ended"}                         Cloud stream closed
 *
 * Auth reuses GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 (same GCP project as TTS;
 * the Speech-to-Text API must be enabled on it).
 *
 * GOTCHA (POC): the streaming method is the UNDERSCORE-prefixed
 * `client._streamingRecognize()`. The public `streamingRecognize()` wrapper
 * fails with `INVALID_ARGUMENT: Invalid resource field value` because it does
 * not attach the recognizer to the gRPC routing header.
 */

const { WebSocket } = require("ws");
const { v2 } = require("@google-cloud/speech");

// Region: Chirp/long streaming with real-time interim is only in us / eu (not
// asia yet - see POC). us is the default; override via env if eu is closer for
// a given deployment. This adds JP->US network latency vs the asia sync path,
// which is the accepted trade-off for real-time display (measured on deploy).
const LOCATION = process.env.STT_STREAM_LOCATION?.trim() || "us";
const MODEL = process.env.STT_STREAM_MODEL?.trim() || "long";
// Explicit language list. `long` does NOT accept "auto" (that is Chirp-only);
// it detects within the codes we list. Fewer codes = higher accuracy, so we
// list ONLY the languages the UI actually exposes (ja/en). Adding more (vi, ...)
// measurably hurt recognition of the two real languages. Override via env if a
// deployment needs a different set.
const LANGS = (process.env.STT_STREAM_LANGS?.trim() || "ja-JP,en-US")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Browser sends 16 kHz mono PCM16 (downsampled client-side). Streaming v2
// requires explicitDecodingConfig (unlike sync's autoDecodingConfig).
const SAMPLE_RATE = parseInt(process.env.STT_STREAM_SAMPLE_RATE || "16000", 10);

// -----------------------------------------------------------------------------
// Service-account credential loader (mirrors cloud-stt-bridge.js)
// -----------------------------------------------------------------------------
let cachedCredentials = null;
function loadServiceAccount() {
  if (cachedCredentials) return cachedCredentials;
  const b64Raw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_BASE64?.trim();
  if (!b64Raw) return null;
  try {
    const b64 = b64Raw
      .replace(/^['"]|['"]$/g, "")
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const raw = Buffer.from(b64, "base64").toString("utf-8");
    cachedCredentials = JSON.parse(raw);
    return cachedCredentials;
  } catch (err) {
    console.error("[SttStream] failed to parse GOOGLE_TTS_SERVICE_ACCOUNT_BASE64", err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Per-process v2 Speech client (reuses gRPC channel across connections)
// -----------------------------------------------------------------------------
let cachedClient = null;
let cachedProjectId = null;
function getClient() {
  if (cachedClient && cachedProjectId) {
    return { client: cachedClient, projectId: cachedProjectId };
  }
  const creds = loadServiceAccount();
  if (!creds) {
    throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 not configured");
  }
  const projectId = creds.project_id;
  if (!projectId) {
    throw new Error("Service account JSON has no project_id");
  }
  cachedClient = new v2.SpeechClient({
    credentials: creds,
    projectId,
    apiEndpoint: `${LOCATION}-speech.googleapis.com`,
  });
  cachedProjectId = projectId;
  return { client: cachedClient, projectId };
}

// Chirp/long tokenises CJK output with spaces; collapse spaces between two
// CJK/kana chars so the transcript reads naturally (same as the sync path).
const CJK = "\\u3001-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff66-\\uff9f";
const CJK_SPACE_RE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "g");
function cleanupTranscript(text) {
  let out = text;
  out = out.replace(CJK_SPACE_RE, "$1").replace(CJK_SPACE_RE, "$1");
  out = out.replace(/\s+([、。！？」』）])/g, "$1");
  return out.trim();
}

// -----------------------------------------------------------------------------
// WS connection handler
// -----------------------------------------------------------------------------
/**
 * @param {import('ws').WebSocket} clientWs
 */
function handleSttStreamClient(clientWs) {
  console.log("[SttStream] client connected");
  /** @type {import('google-gax').CancellableStream | null} */
  let stream = null;
  let closed = false;
  let configWritten = false;

  const sendJson = (obj) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  const closeAll = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try {
      stream?.end();
    } catch {
      /* ignore */
    }
    stream = null;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason);
    }
  };

  const openStream = (sessionLangs) => {
    let client, projectId;
    try {
      ({ client, projectId } = getClient());
    } catch (err) {
      sendJson({ type: "error", message: err instanceof Error ? err.message : String(err) });
      closeAll(1011, "no credentials");
      return;
    }

    // Per-session language codes take priority over the env default: the client
    // picks the mic input language, so a single explicit code (e.g. "ko-KR")
    // gives the `long` model both interim AND correct recognition for it.
    const langCodes = Array.isArray(sessionLangs) && sessionLangs.length ? sessionLangs : LANGS;

    const recognizer = `projects/${projectId}/locations/${LOCATION}/recognizers/_`;

    stream = client._streamingRecognize();
    stream
      .on("error", (err) => {
        console.error("[SttStream] stream error:", err.message);
        sendJson({ type: "error", message: err.message });
        closeAll(1011, "stt error");
      })
      .on("data", (response) => {
        const result = response.results?.[0];
        if (!result) return;
        const alt = result.alternatives?.[0];
        if (!alt || typeof alt.transcript !== "string") return;
        sendJson({
          type: "transcript",
          text: cleanupTranscript(alt.transcript),
          isFinal: !!result.isFinal,
          lang: result.languageCode || "",
        });
      })
      .on("end", () => {
        sendJson({ type: "ended" });
        closeAll(1000, "stt ended");
      });

    // First message = config only. Subsequent messages = audio chunks.
    try {
      stream.write({
        recognizer,
        streamingConfig: {
          config: {
            explicitDecodingConfig: {
              encoding: "LINEAR16",
              sampleRateHertz: SAMPLE_RATE,
              audioChannelCount: 1,
            },
            languageCodes: langCodes,
            model: MODEL,
            features: { enableAutomaticPunctuation: true },
          },
          streamingFeatures: { interimResults: true },
        },
      });
      configWritten = true;
    } catch (err) {
      sendJson({ type: "error", message: err instanceof Error ? err.message : String(err) });
      closeAll(1011, "config write failed");
      return;
    }

    sendJson({ type: "ready" });
  };

  clientWs.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (!stream || !configWritten) {
        console.warn("[SttStream] audio frame before stream open, dropping");
        return;
      }
      try {
        stream.write({ audio: data });
      } catch (err) {
        console.error("[SttStream] write failed:", err);
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === "start") {
      if (stream) {
        try {
          stream.end();
        } catch {
          /* ignore */
        }
        stream = null;
        configWritten = false;
      }
      // Optional per-session language: single BCP-47 code the client picked.
      const sessionLangs =
        typeof msg.lang === "string" && msg.lang.trim() ? [msg.lang.trim()] : null;
      openStream(sessionLangs);
    } else if (msg?.type === "stop") {
      // Half-close the write side; Google flushes the final result and the
      // read side's `end` fires `ended` on the browser.
      try {
        stream?.end();
      } catch {
        /* ignore */
      }
    }
  });

  clientWs.on("close", () => closeAll());
  clientWs.on("error", (err) => {
    console.error("[SttStream] client error:", err.message);
    closeAll(1011, "client error");
  });
}

module.exports = { handleSttStreamClient };
