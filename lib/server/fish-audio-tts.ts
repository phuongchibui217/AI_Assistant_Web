import "server-only";

/**
 * Server-side Fish Audio text-to-speech client (issue 4). Used for the
 * Japanese voice when `FISH_AUDIO_API_KEY` is set; otherwise the Japanese
 * answer falls back to Google Cloud TTS.
 *
 * Lives under `lib/server/*` so the API key never reaches the client bundle.
 *
 * Output is requested as `format: "pcm"` + `sample_rate: 24000`. Fish returns
 * raw 16-bit little-endian mono PCM, byte-identical to what the Google path
 * emits after its WAV header is stripped and what Azure emits, so the client
 * audio pipeline (AudioStreamPlayer, LINEAR16 @ 24 kHz) needs no change.
 */

const ENDPOINT = "https://api.fish.audio/v1/tts";
const SAMPLE_RATE = 24_000;

// Per-language Fish voice (marketplace model id). One English voice can't do
// every language (it sounded near-silent on tonal Vietnamese), so each language
// gets a region-appropriate voice. Fish OFFICIALLY supports only en/ja (+ ko/zh/
// fr/de/ar/es); vi/id here are COMMUNITY voices on an unofficial language, so
// treat their quality as experimental - verify by ear before shipping.
// FISH_AUDIO_VOICE_ID, if set, forces ONE voice for every language (override).
const VOICE_BY_LANG: Record<string, string> = {
  ja: "212888bba6dc4ee2af86e4cf78da2846", // Reina Fujisaki (client-made persona voice)
  en: "933563129e564b19a115bedd57b7406a", // Sarah
  vi: "2e324e52a86c4ec69d98bb99e1b61c5b", // Vietnam (community)
  id: "90195a80328f42bb9f282a389de72e01", // Indonesian/Melayu (community)
};

// Male-avatar (一ノ瀬) voices, by language prefix. Only JP has a vetted male
// voice today; any language not listed here falls through to the default above.
const MALE_VOICE_BY_LANG: Record<string, string> = {
  ja: "8714c3fa7e464c31a18a9e1e07998759", // Eita Ichinose (client-made persona voice)
};

function voiceForLanguage(
  languageCode: string | undefined,
  gender?: "female" | "male",
): string {
  const override = process.env.FISH_AUDIO_VOICE_ID?.trim();
  if (override) return override;
  const lc = (languageCode || "ja").toLowerCase();
  if (gender === "male") {
    for (const [prefix, id] of Object.entries(MALE_VOICE_BY_LANG)) {
      if (lc.startsWith(prefix)) return id;
    }
  }
  for (const [prefix, id] of Object.entries(VOICE_BY_LANG)) {
    if (lc.startsWith(prefix)) return id;
  }
  return VOICE_BY_LANG.ja;
}

// Backend model (sent as the `model` header): "s1" or "s2-pro".
const DEFAULT_MODEL = "s1";

// Sampling controls, lower than Fish's defaults (temperature 0.7 / top_p 0.7).
// Fish is generative and samples a fresh "take" per request - with the default
// randomness the same persona voice drifted in tone from one bubble to the next
// across a conversation. There is no seed parameter, so cutting the sampling
// temperature is the lever for a CONSISTENT tone. Env-tunable: raise toward 0.7
// for more expressiveness, lower toward 0 for a flatter but rock-steady voice.
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
const FISH_TEMPERATURE = envNum("FISH_AUDIO_TEMPERATURE", 0.5);
const FISH_TOP_P = envNum("FISH_AUDIO_TOP_P", 0.7);
// Fish's built-in latency mode: "normal" (highest quality, slowest) vs
// "balanced" (noticeably lower time-to-audio for a small quality trade-off).
// JP answers were ~4-5s on "normal"; "balanced" is the cheap first lever.
// Env-tunable so it's trivial to flip back to "normal" if quality regresses.
const FISH_LATENCY = process.env.FISH_AUDIO_LATENCY?.trim() || "balanced";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 750, 2_000];

export class FishAudioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FishAudioError";
  }
}

/** True when a Fish Audio key is configured, so the route can opt JP into it. */
export function fishAudioEnabled(): boolean {
  return !!process.env.FISH_AUDIO_API_KEY?.trim();
}

// Languages routed to Fish, as comma-separated BCP-47 prefixes (each uses its
// VOICE_BY_LANG voice). ONLY Japanese by default: that is the client-made
// persona voice (Reina/Eita) and Fish's reason for being here. English used to
// be on Fish too, but its marketplace "Sarah" voice is unstable - being a
// generative model, Fish sampled a different tone each request and occasionally
// drifted to a MALE-sounding take even on the female persona. Google's en-US
// Neural2 is deterministic, consistent, and always the correct gender, so
// English now falls through to Google (voiceFor handles the en male/female
// voice). The vi/id community voices were likewise unusable. Re-add via
// FISH_AUDIO_LANGS="ja,en" only if a solid English Fish voice appears.
const FISH_LANGS = (process.env.FISH_AUDIO_LANGS?.trim() || "ja")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Whether Fish should handle `languageCode`. An undefined/empty code means the
 * server default voice (Japanese), so it maps to "ja".
 */
export function fishSupportsLanguage(
  languageCode: string | undefined,
  gender?: "female" | "male",
): boolean {
  const lc = (languageCode || "ja").toLowerCase();
  // Male: only Japanese has a Fish persona voice (Eita); other male voices come
  // from Google/Azure, so don't route them to Fish (it has no male en voice and
  // would fall back to the female one). Female: the configured FISH_LANGS.
  if (gender === "male") return lc.startsWith("ja");
  return FISH_LANGS.some((prefix) => lc.startsWith(prefix));
}

/**
 * Issue the Fish Audio TTS request with the shared retry-on-transient-5xx
 * logic, returning the raw `Response` once it is `ok`. Both `synthesizeFish`
 * (buffers the whole body) and `synthesizeFishStream` (pipes the body through
 * as it arrives) share this - retry only ever applies to the INITIAL
 * connect/status, never mid-stream (once bytes start flowing there is no
 * clean way to "retry" without a second generative take, which would violate
 * the one-request-per-batch rule).
 */
async function fishRequest(
  text: string,
  languageCode?: string,
  gender?: "female" | "male",
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = process.env.FISH_AUDIO_API_KEY?.trim();
  if (!apiKey) throw new FishAudioError("FISH_AUDIO_API_KEY not configured");

  const voiceId = voiceForLanguage(languageCode, gender);
  const model = process.env.FISH_AUDIO_MODEL?.trim() || DEFAULT_MODEL;

  const body = JSON.stringify({
    text,
    reference_id: voiceId,
    format: "pcm",
    sample_rate: SAMPLE_RATE,
    normalize: true,
    latency: FISH_LATENCY,
    // Keep the persona tone steady across the whole conversation (see consts).
    temperature: FISH_TEMPERATURE,
    top_p: FISH_TOP_P,
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          model,
        },
        body,
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (
          RETRYABLE_STATUSES.has(res.status) &&
          attempt < RETRY_DELAYS_MS.length - 1
        ) {
          lastError = new FishAudioError(
            `Fish Audio ${res.status}: ${errText.slice(0, 200)}`,
            res.status,
          );
          continue;
        }
        throw new FishAudioError(
          `Fish Audio ${res.status}: ${errText.slice(0, 200)}`,
          res.status,
        );
      }

      return res;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= RETRY_DELAYS_MS.length - 1) throw lastError;
    }
  }

  throw lastError ?? new FishAudioError("Fish Audio request failed (unknown)");
}

/**
 * Synthesize `text` and return raw LINEAR16 PCM mono @ 24 kHz. Throws
 * `FishAudioError` on a missing key or non-2xx (after retrying transient 5xx).
 */
export async function synthesizeFish(
  text: string,
  languageCode?: string,
  gender?: "female" | "male",
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!text.trim()) return new Uint8Array(0);
  const res = await fishRequest(text, languageCode, gender, signal);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Streaming variant of {@link synthesizeFish}: same single request (one
 * generative "take" per batch, per issue 4's per-sentence-voice-drift fix),
 * but returns the `Response` with its body untouched so the caller can pipe
 * PCM chunks through as they arrive instead of waiting for the full body.
 * Fish's time-to-first-byte is ~320ms regardless of text length, so this is
 * what cuts time-to-first-audio on long batches from ~4-5s to sub-second.
 */
export async function synthesizeFishStream(
  text: string,
  languageCode?: string,
  gender?: "female" | "male",
  signal?: AbortSignal,
): Promise<Response> {
  return fishRequest(text, languageCode, gender, signal);
}
