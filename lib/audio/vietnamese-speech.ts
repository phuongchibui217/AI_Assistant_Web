import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";

import voice from "../../public/voices/vi/vi_VN-vivos-x_low.onnx.json";
import { chunkTextByBytes, splitIntoSentences } from "../sentence-split";

const MODEL_PATH = "/voices/vi/vi_VN-vivos-x_low.onnx";
const SPEAKERS = { male: 50, female: 20 } as const;
const phonemeMap: Record<string, number[]> = voice.phoneme_id_map;
const rate = voice.audio.sample_rate;

env.wasm.numThreads = 1;
env.wasm.wasmPaths = {
  mjs: new URL("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url).href,
  wasm: new URL("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url).href,
};

let vietnameseSession: Promise<InferenceSession> | undefined;

function loadVietnameseVoice(): Promise<InferenceSession> {
  const source = new URL(MODEL_PATH, self.location.origin).href;
  vietnameseSession ??= InferenceSession.create(source, { executionProviders: ["wasm"] }).catch((error) => {
    vietnameseSession = undefined;
    throw error;
  });
  return vietnameseSession;
}

export function normalizeVietnameseSpeech(text: string): string {
  return text.normalize("NFC")
    .replace(/\bLee\b/gi, "Li")
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, hour: string, minute: string) => (
      minute === "00" ? `${hour} giờ` : `${hour} giờ ${Number(minute)} phút`
    ))
    .replace(/(\d)\s*%/g, "$1 phần trăm")
    .replace(/(quý\s+\d)\s*\/\s*(\d{4})/giu, "$1 năm $2");
}

function phonemeIds(sentence: string, phonemize: (text: string) => string): BigInt64Array {
  const ids = [...phonemeMap["^"], ...phonemeMap._];
  const parts = sentence.split(/([,;:.!?])(?=\s|$)/u);
  for (const [index, part] of parts.entries()) {
    const content = part.trim();
    if (!content) continue;
    const rendered = index % 2 === 0 ? phonemize(content) : content;
    if (index % 2 === 0 && /^\s/u.test(part)) ids.push(...phonemeMap[" "], ...phonemeMap._);
    for (const phoneme of rendered.normalize("NFD").replace(/\s+/gu, " ").trim()) {
      const mapped = phonemeMap[phoneme];
      if (mapped) ids.push(...mapped, ...phonemeMap._);
    }
  }
  ids.push(...phonemeMap.$);
  return BigInt64Array.from(ids, BigInt);
}

export async function synthesizeVietnameseSpeech(
  text: string,
  gender: keyof typeof SPEAKERS,
  phonemize: (text: string) => string,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const session = await loadVietnameseVoice();
  const phrases = splitIntoSentences(text).flatMap((line) => chunkTextByBytes(line, 750));
  const parts: Float32Array[] = [];
  const gap = Math.round(rate * 0.16);
  const edge = Math.round(rate * 0.008);
  for (const phrase of phrases) {
    const units = phonemeIds(phrase, phonemize);
    if (units.length < 5) continue;
    const data = await session.run({
      input: new Tensor("int64", units, [1, units.length]),
      input_lengths: new Tensor("int64", BigInt64Array.of(BigInt(units.length)), [1]),
      scales: new Tensor("float32", Float32Array.of(0.55, 1.04, 0.68), [3]),
      sid: new Tensor("int64", BigInt64Array.of(BigInt(SPEAKERS[gender])), [1]),
    });
    const output = data.output;
    if (output.type !== "float32") throw new Error("Unexpected Vietnamese voice audio format");
    const wave = output.data as Float32Array;
    const first = wave.findIndex((v) => Math.abs(v) > 0.008);
    let last = wave.length - 1;
    while (last > first && Math.abs(wave[last]) <= 0.008) last--;
    if (first < 0 || last <= first) continue;
    const segment = wave.slice(Math.max(0, first - edge), Math.min(last + edge + 1, wave.length));
    let peak = 0;
    for (const v of segment) peak = Math.max(peak, Math.abs(v));
    const gain = Math.min(3, 0.62 / peak);
    for (let i = 0; i < segment.length; i++) {
      segment[i] *= gain * Math.min(1, i / edge, (segment.length - 1 - i) / edge);
    }
    parts.push(segment);
  }

  if (!parts.length) throw new Error("Vietnamese voice returned no speech");
  const length = parts.reduce((sum, part) => sum + part.length, 0) + gap * (parts.length - 1);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length + gap;
  }
  return { samples, sampleRate: rate };
}
