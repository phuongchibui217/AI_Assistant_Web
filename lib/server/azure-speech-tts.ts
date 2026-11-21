import "server-only";

/**
 * Server-side Azure Speech text-to-speech client. Primary use: languages
 * Google Cloud TTS does not cover - Nepali (ne-NP) and Burmese (my-MM) -
 * always routed here regardless of TTS_ENGINE (see azureSupports()).
 *
 * Secondary use: DIAGNOSTIC. Setting TTS_ENGINE=azure (route.ts) forces
 * EVERY language through this module instead of Google Cloud TTS, to test
 * whether the client-reported "beep" artifact is specific to the Google
 * response pipeline or reproduces on a completely different TTS engine.
 * The VOICE_MAP/MALE_VOICE_MAP entries below beyond ne-NP/my-MM exist only
 * for that diagnostic path.
 *
 * Lives under `lib/server/*` so the subscription key never reaches the client
 * bundle.
 *
 * Output is requested as `raw-24khz-16bit-mono-pcm` = raw 16-bit little-endian
 * PCM mono at 24 kHz, byte-identical to what the Google path emits after its
 * WAV header is stripped. The client audio pipeline (AudioStreamPlayer,
 * expecting LINEAR16 @ 24 kHz) therefore needs no change - same PCM shape
 * regardless of which engine produced it.
 */

const DEFAULT_REGION = "japaneast";
const OUTPUT_FORMAT = "raw-24khz-16bit-mono-pcm";

// Default (female) neural voice per language. ne-NP/my-MM are the two
// always-on entries (Google has no voice for them); the rest are only
// reached when TTS_ENGINE=azure forces every language through this module -
// same key space as lang-detect.ts's FEMALE_VOICE_MAP (Google-style codes).
const VOICE_MAP: Record<string, string> = {
  "ne-NP": "ne-NP-HemkalaNeural",
  "my-MM": "my-MM-NilarNeural",
  "ja-JP": "ja-JP-NanamiNeural",
  "en-US": "en-US-AriaNeural",
  "ko-KR": "ko-KR-SunHiNeural",
  "cmn-CN": "zh-CN-XiaoxiaoNeural",
  "cmn-TW": "zh-TW-HsiaoChenNeural",
  "ru-RU": "ru-RU-SvetlanaNeural",
  "vi-VN": "vi-VN-HoaiMyNeural",
  "id-ID": "id-ID-GadisNeural",
  "th-TH": "th-TH-PremwadeeNeural",
  "fil-PH": "fil-PH-BlessicaNeural",
  "pt-BR": "pt-BR-FranciscaNeural",
};

// Male Azure neural voices, used when the avatar gender is male. Falls back to
// the female VOICE_MAP entry for any code without a male voice.
const MALE_VOICE_MAP: Record<string, string> = {
  "ne-NP": "ne-NP-SagarNeural",
  "my-MM": "my-MM-ThihaNeural",
  "ja-JP": "ja-JP-KeitaNeural",
  "en-US": "en-US-ChristopherNeural",
  "ko-KR": "ko-KR-InJoonNeural",
  "cmn-CN": "zh-CN-YunjianNeural",
  "cmn-TW": "zh-TW-YunJheNeural",
  "ru-RU": "ru-RU-DmitryNeural",
  "vi-VN": "vi-VN-NamMinhNeural",
  "id-ID": "id-ID-ArdiNeural",
  "th-TH": "th-TH-NiwatNeural",
  "fil-PH": "fil-PH-AngeloNeural",
  "pt-BR": "pt-BR-AntonioNeural",
};

// Languages ALWAYS routed to Azure, regardless of TTS_ENGINE - Google Cloud
// TTS has no voice for either. Deliberately NOT "languageCode in VOICE_MAP":
// that map now also holds diagnostic-only entries (see file docstring) that
// must stay Google's by default and only reach this module via the explicit
// TTS_ENGINE=azure override in route.ts.
const ALWAYS_ON_LANGUAGES = new Set(["ne-NP", "my-MM"]);

export function azureSupports(languageCode: string): boolean {
  return ALWAYS_ON_LANGUAGES.has(languageCode);
}

export class AzureSpeechError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AzureSpeechError";
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Synthesize `text` in `languageCode` and return raw LINEAR16 PCM mono @ 24 kHz.
 * Throws `AzureSpeechError` on a missing key, unsupported language, or non-2xx.
 */
export async function synthesizeAzure(
  text: string,
  languageCode: string,
  gender: "female" | "male" = "female",
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const apiKey = process.env.AZURE_SPEECH_KEY;
  if (!apiKey) throw new AzureSpeechError("AZURE_SPEECH_KEY not configured");

  const voice =
    gender === "male"
      ? MALE_VOICE_MAP[languageCode] ?? VOICE_MAP[languageCode]
      : VOICE_MAP[languageCode];
  if (!voice) throw new AzureSpeechError(`No Azure voice for ${languageCode}`);

  const region = process.env.AZURE_SPEECH_REGION ?? DEFAULT_REGION;
  // The synthesis host is region-derived (`{region}.tts.speech.microsoft.com`),
  // which is NOT the same as the resource's cognitiveservices endpoint.
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const ssml =
    `<speak version='1.0' xml:lang='${languageCode}'>` +
    `<voice name='${voice}'>${escapeXml(text)}</voice></speak>`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
      "User-Agent": "ai-assistant-web",
    },
    body: ssml,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AzureSpeechError(
      `Azure Speech ${res.status}: ${errText.slice(0, 200)}`,
      res.status,
    );
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
