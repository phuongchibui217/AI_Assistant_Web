// @ts-check
/**
 * Browser WS ↔ Google Cloud Speech-to-Text streaming bridge.
 *
 * Protocol (browser → server):
 *   - JSON  {type:"start", lang:"ja-JP"}      open the recognise stream
 *   - Binary frames                           webm/opus chunks from MediaRecorder
 *   - JSON  {type:"stop"}                     finish the stream
 *
 * Protocol (server → browser):
 *   - JSON  {type:"ready"}                    Cloud stream is open, send audio
 *   - JSON  {type:"transcript", text, isFinal}
 *   - JSON  {type:"error", message}
 *   - JSON  {type:"ended"}                    Cloud stream closed
 *
 * Authentication reuses GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 (same Google Cloud
 * project as TTS - Speech-to-Text API must be enabled separately).
 */

const { WebSocket } = require("ws");
const speech = require("@google-cloud/speech").v1;

// -----------------------------------------------------------------------------
// Service-account credential loader (mirrors lib/server/google-tts.ts)
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
    console.error("[Stt] failed to parse GOOGLE_TTS_SERVICE_ACCOUNT_BASE64", err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Per-process Speech client (reuses gRPC channel across connections)
// -----------------------------------------------------------------------------
let cachedClient = null;
function getClient() {
  if (cachedClient) return cachedClient;
  const creds = loadServiceAccount();
  if (!creds) {
    throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT_BASE64 not configured");
  }
  cachedClient = new speech.SpeechClient({ credentials: creds });
  return cachedClient;
}

// -----------------------------------------------------------------------------
// WS connection handler
// -----------------------------------------------------------------------------
/**
 * @param {import('ws').WebSocket} clientWs
 */
// Silence after speech before we finalize the utterance. Google v1
// single_utterance ends on its own end-of-speech heuristic (~3 s observed),
// which felt sluggish in testing - the user finishes speaking and waits.
// We arm our own timer that ends the recognise stream 1.2 s after the last
// transcript, so the answer starts sooner. single_utterance stays on as a
// fallback. Value chosen per 20260601 feedback #3.
const SPEECH_END_SILENCE_MS = 1200;

// Base languages (BCP-47 primary subtag) that support Cloud STT v1's
// "latest_short" model. The app's mic languages are ja/en/ko/zh/ru/vi/id
// (all supported) plus my/ne (Burmese/Nepali - default-model-only). Requesting
// latest_short for an unsupported language hard-errors the stream, so gate on
// this set and fall back to the default model for anything not listed.
const LATEST_SHORT_LANGS = new Set([
  "ja",
  "en",
  "ko",
  "zh",
  "cmn",
  "ru",
  "vi",
  "id",
]);

/** @param {string} languageCode e.g. "en-US", "zh-CN" */
function supportsLatestShort(languageCode) {
  const base = languageCode.toLowerCase().split("-")[0];
  return LATEST_SHORT_LANGS.has(base);
}

function handleSttClient(clientWs) {
  console.log("[Stt] client connected");
  /** @type {ReturnType<speech.SpeechClient["streamingRecognize"]> | null} */
  let stream = null;
  let closed = false;
  let audioFrameCount = 0;
  /** @type {NodeJS.Timeout | null} */
  let silenceTimer = null;

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };
  // (Re)start the silence countdown. Called on every transcript so it only
  // begins after the user has actually said something, and resets while they
  // keep speaking. On expiry we half-close the write side; Google flushes the
  // final result and the read side's `end` fires finalise() on the browser.
  const armSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      try {
        stream?.end();
      } catch {
        /* ignore */
      }
    }, SPEECH_END_SILENCE_MS);
  };

  const sendJson = (obj) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  const closeAll = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearSilenceTimer();
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

  const openStream = (lang, format) => {
    let client;
    try {
      client = getClient();
    } catch (err) {
      sendJson({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      closeAll(1011, "no credentials");
      return;
    }

    // Two transport profiles share this bridge:
    //   - "webm-opus" (default): the web client's MediaRecorder emits a
    //     continuous webm/opus stream at 48 kHz. We declare the rate
    //     explicitly because the API rejects "0".
    //   - "linear16": the Unity client sends raw int16 mono PCM at 16 kHz.
    //     Unity has no native webm/opus encoder; LINEAR16 avoids dragging
    //     a muxer into the app and matches the rate Cloud STT recommends
    //     for raw mic input.
    const isLinear16 = format === "linear16";
    const languageCode = lang || "ja-JP";
    stream = client
      .streamingRecognize({
        config: {
          encoding: /** @type {any} */ (isLinear16 ? "LINEAR16" : "WEBM_OPUS"),
          sampleRateHertz: isLinear16 ? 16000 : 48000,
          languageCode,
          enableAutomaticPunctuation: true,
          // Push-to-talk = short utterances. "latest_short" is Google's
          // improved recognition model for short-form input, markedly more
          // accurate than the default model across non-JP languages
          // (en/ko/zh) where the default was weak. Same v1 streaming API.
          // NOT all languages support latest_short - Burmese (my) / Nepali
          // (ne) are default-model-only and would hard-error on it, so only
          // request the model for languages known to support it; the rest
          // fall through to the default model (degraded, not broken).
          ...(supportsLatestShort(languageCode) ? { model: "latest_short" } : {}),
        },
        interimResults: true,
        singleUtterance: true,
      })
      .on("error", (err) => {
        console.error("[Stt] stream error:", err.message);
        sendJson({ type: "error", message: err.message });
        closeAll(1011, "stt error");
      })
      .on("data", (response) => {
        if (response.speechEventType === "END_OF_SINGLE_UTTERANCE") {
          sendJson({ type: "endOfUtterance" });
          return;
        }
        const result = response.results?.[0];
        if (!result) return;
        const alt = result.alternatives?.[0];
        if (!alt || typeof alt.transcript !== "string") return;
        sendJson({
          type: "transcript",
          text: alt.transcript,
          isFinal: !!result.isFinal,
        });
        // Reset the post-speech silence countdown on every transcript (interim
        // or final) so it only fires once the user actually stops talking.
        armSilenceTimer();
        // single_utterance returns exactly one final result; Google does not
        // close the stream itself when the client keeps writing audio frames
        // (the MediaRecorder is still emitting webm chunks post-speech), so
        // we close the writable side here to unblock the read side's `end`
        // event and let `finalise()` fire on the browser.
        if (result.isFinal) {
          try {
            stream?.end();
          } catch {
            /* ignore */
          }
        }
      })
      .on("end", () => {
        sendJson({ type: "ended" });
        closeAll(1000, "stt ended");
      });

    sendJson({ type: "ready" });
  };

  clientWs.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (!stream) {
        console.warn("[Stt] audio frame before stream open, dropping");
        return;
      }
      audioFrameCount += 1;
      if (audioFrameCount <= 3 || audioFrameCount % 20 === 0) {
        const len = data instanceof Buffer ? data.length : data.byteLength;
        console.log(`[Stt] audio frame #${audioFrameCount} bytes=${len}`);
      }
      try {
        stream.write(data);
      } catch (err) {
        console.error("[Stt] write failed:", err);
      }
      return;
    }
    // Text frame - control message
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === "start") {
      if (stream) {
        // Reuse: close old stream and start fresh language
        try {
          stream.end();
        } catch {
          /* ignore */
        }
        stream = null;
      }
      openStream(
        typeof msg.lang === "string" ? msg.lang : "ja-JP",
        typeof msg.format === "string" ? msg.format : "webm-opus",
      );
    } else if (msg?.type === "stop") {
      try {
        stream?.end();
      } catch {
        /* ignore */
      }
      stream = null;
    }
  });

  clientWs.on("close", () => closeAll());
  clientWs.on("error", (err) => {
    console.error("[Stt] client error:", err.message);
    closeAll(1011, "client error");
  });
}

module.exports = { handleSttClient };
