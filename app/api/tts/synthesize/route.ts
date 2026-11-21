import { NextResponse } from "next/server";

import { AzureSpeechError, azureSupports, synthesizeAzure } from "@/lib/server/azure-speech-tts";
import { ElevenLabsError, synthesizeElevenLabs } from "@/lib/server/elevenlabs-tts";
import { synthesizeSpeech, TtsError } from "@/lib/server/google-tts";
import { applyLexemes, getLexemes } from "@/lib/server/lexemes";
import { chunkTextByBytes } from "@/lib/sentence-split";

// Google Cloud TTS rejects input longer than 5000 bytes. Split below that with
// headroom for the per-chunk lexeme SSML tag overhead added downstream.
const TTS_MAX_INPUT_BYTES = 4000;

function concatPcm(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Language codes routed to Azure Speech because Google Cloud TTS has no voice
// for them: Nepali (ne-NP) and Burmese (my-MM). Azure covers both (the set is
// defined in azure-speech-tts.ts).

// DIAGNOSTIC toggle (2026-09-14): set TTS_ENGINE=azure to route EVERY
// language through Azure Speech (normally only ne-NP/my-MM use it) instead
// of Google Cloud TTS, to test whether the client-reported "beep" artifact
// is specific to the Google response pipeline or reproduces on a totally
// different TTS engine. Azure already returns the exact same raw
// LINEAR16 24kHz PCM shape as Google, so this needs no pipeline change.
// Default (unset/anything else) keeps the existing per-language routing.
const FORCE_AZURE_TTS = process.env.TTS_ENGINE === "azure";

// DIAGNOSTIC toggle (2026-09-14): same idea, routed through ElevenLabs
// instead. Also emits raw pcm_24000, so no pipeline change either.
const FORCE_ELEVENLABS_TTS = process.env.TTS_ENGINE === "elevenlabs";

/**
 * TTS synthesise endpoint. The client calls this once per batch after Flash
 * streams text; each response is raw LINEAR16 mono PCM at 24 kHz, ready to
 * drop into the `AudioStreamPlayer` queue without any decoding step.
 *
 * Google Cloud TTS with `audioEncoding=LINEAR16` returns a full WAV file
 * (RIFF header + format chunk + "data" chunk). We strip the header before
 * sending so the client receives raw PCM only - otherwise the first 44ish
 * bytes are interpreted as PCM samples and produce a click + skew the
 * lip-sync RMS for a few frames.
 *
 * Default routing (TTS_ENGINE unset): supported languages -> Google Cloud
 * TTS; ne-NP/my-MM (no Google voice) -> Azure Speech. Fish Audio
 * (`lib/server/fish-audio-tts.ts`) is NOT part of default routing (2026-09-15
 * - its key is dead and `fishAudioEnabled()` only checks presence, not
 * validity, so wiring it back in would silently break ja/en whenever the key
 * expires again). Azure/ElevenLabs are also reachable via the TTS_ENGINE
 * diagnostic toggle below, forcing every language through one engine.
 */

/**
 * Scan a WAV byte stream for the `"data"` ASCII tag and return the bytes
 * that follow its 4-byte size prefix. Falls back to the original input
 * unchanged if no `"data"` tag is found (covers raw PCM, mu-law, etc.).
 */
function stripWavHeader(wav: Uint8Array): Uint8Array {
  // A valid RIFF/WAVE file starts with "RIFF....WAVE". If we don't see
  // that, assume the response is already raw and return it as-is.
  if (
    wav.length < 12 ||
    wav[0] !== 0x52 || wav[1] !== 0x49 || wav[2] !== 0x46 || wav[3] !== 0x46 || // RIFF
    wav[8] !== 0x57 || wav[9] !== 0x41 || wav[10] !== 0x56 || wav[11] !== 0x45 // WAVE
  ) {
    return wav;
  }
  // Find the "data" sub-chunk (0x64 0x61 0x74 0x61). PCM samples start 8
  // bytes after the tag (4 tag + 4 size).
  for (let i = 12; i < wav.length - 8; i++) {
    if (
      wav[i] === 0x64 && wav[i + 1] === 0x61 &&
      wav[i + 2] === 0x74 && wav[i + 3] === 0x61
    ) {
      return wav.subarray(i + 8);
    }
  }
  return wav;
}

export async function POST(req: Request): Promise<Response> {
  let body: {
    text?: unknown;
    voice?: unknown;
    languageCode?: unknown;
    speakingRate?: unknown;
    pitch?: unknown;
    gender?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Missing 'text'" }, { status: 400 });
  }

  const languageCode =
    typeof body.languageCode === "string" ? body.languageCode : undefined;
  const gender = body.gender === "male" ? "male" : "female";

  try {
    let pcm: Uint8Array;
    if (languageCode && (FORCE_AZURE_TTS || azureSupports(languageCode))) {
      // Azure returns raw 24 kHz PCM already (no WAV header). Lexemes are
      // Japanese-company-name pronunciation overrides, irrelevant here, so we
      // synthesize the plain answer text. Gender picks the male/female Azure voice.
      pcm = await synthesizeAzure(body.text, languageCode, gender, req.signal);
    } else if (FORCE_ELEVENLABS_TTS) {
      // ElevenLabs returns raw pcm_24000 already (no WAV header), same as
      // Azure. Lexemes irrelevant (plain text like Azure).
      pcm = await synthesizeElevenLabs(body.text, {}, req.signal);
    } else {
      // Split overlong input under the 5000-byte TTS limit BEFORE applying
      // lexemes, so chunking stays on plain text (no risk of cutting an SSML
      // tag) and each chunk's lexeme SSML still fits. Short answers yield a
      // single chunk = identical to the old single-request path.
      const lexemes = await getLexemes();
      const opts = {
        voice: typeof body.voice === "string" ? body.voice : undefined,
        languageCode,
        speakingRate:
          typeof body.speakingRate === "number" ? body.speakingRate : undefined,
        pitch: typeof body.pitch === "number" ? body.pitch : undefined,
      };
      const pieces = chunkTextByBytes(body.text, TTS_MAX_INPUT_BYTES);
      const parts: Uint8Array[] = [];
      for (const piece of pieces) {
        // Run each piece through the admin-managed lexeme list. If any grapheme
        // matches we get back SSML with `<phoneme>` overrides + alias swaps;
        // otherwise plain text so we don't pay the SSML parser cost.
        const lexed = applyLexemes(piece, lexemes);
        const wav = await synthesizeSpeech(
          lexed?.ssml ?? piece,
          { ...opts, ssml: lexed !== null },
          req.signal,
        );
        parts.push(stripWavHeader(wav));
      }
      // LINEAR16 raw PCM at the same rate concatenates byte-for-byte.
      pcm = parts.length > 0 ? concatPcm(parts) : new Uint8Array(0);
    }
    // Slice to a plain ArrayBuffer - Node 22's `Response` constructor wants
    // the ArrayBuffer-backed shape, not the union with SharedArrayBuffer
    // that TS infers from Buffer.from.
    const audioBuffer = pcm.buffer.slice(
      pcm.byteOffset,
      pcm.byteOffset + pcm.byteLength,
    ) as ArrayBuffer;
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "x-sample-rate": "24000",
        "x-encoding": "LINEAR16",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    const status =
      err instanceof TtsError ||
      err instanceof AzureSpeechError ||
      err instanceof ElevenLabsError
        ? (err.status ?? 502)
        : 502;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
