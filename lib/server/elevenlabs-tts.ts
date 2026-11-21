import "server-only";

/**
 * Server-side ElevenLabs text-to-speech client. Used for languages Google
 * Cloud TTS does not cover - currently Nepali (ne-NP). Burmese (my-MM) has no
 * TTS voice on ElevenLabs either (speech-to-text only), so it stays text-only.
 *
 * Lives under `lib/server/*` so the API key never reaches the client bundle.
 *
 * Output is requested as `pcm_24000` = raw 16-bit little-endian PCM mono at
 * 24 kHz, which is byte-identical to what the Google path emits after its WAV
 * header is stripped. The client audio pipeline (AudioStreamPlayer, expecting
 * LINEAR16 @ 24 kHz) therefore needs no change.
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

// Default female voice (Sarah) to match the avatar persona. The *model*, not
// the voice, supplies the language, so any voice can speak Nepali under v3 -
// override via ELEVENLABS_VOICE_ID if a different timbre is preferred.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
// eleven_v3 is the model with the 70-language roster (incl. Nepali). Override
// via ELEVENLABS_MODEL_ID if account access differs.
const DEFAULT_MODEL_ID = "eleven_v3";
const SAMPLE_RATE = 24000;

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export type ElevenLabsOptions = {
  voiceId?: string;
  modelId?: string;
};

/**
 * Synthesize `text` and return raw LINEAR16 PCM mono @ 24 kHz. Throws
 * `ElevenLabsError` on a missing key or non-2xx response.
 */
export async function synthesizeElevenLabs(
  text: string,
  options: ElevenLabsOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new ElevenLabsError("ELEVENLABS_API_KEY not configured");

  const voiceId =
    options.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId =
    options.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;

  const url = `${ENDPOINT}/${voiceId}?output_format=pcm_${SAMPLE_RATE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/pcm",
    },
    body: JSON.stringify({ text, model_id: modelId }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ElevenLabsError(
      `ElevenLabs ${res.status}: ${errText.slice(0, 200)}`,
      res.status,
    );
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
