import type { SupportedLang } from "../lang-detect";

const DEMO_VOICES: Partial<Record<SupportedLang, string>> = {
  en: "en-us",
  vi: "vi",
  ja: "ja",
  zh: "cmn",
  zhTW: "cmn",
};

export type DemoSpeechRequest = { text: string; voice: string; gender: "male" | "female" };
export type DemoSpeechResult = { pcm: Uint8Array } | { error: string };

let idleVietnameseWorker: Worker | null = null;

export async function synthesizeDemoSpeech(
  text: string,
  lang: SupportedLang,
  gender: DemoSpeechRequest["gender"],
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const voice = DEMO_VOICES[lang];
  if (!voice || !text.trim() || signal.aborted) return null;
  const cachedWorker = voice === "vi" ? idleVietnameseWorker : null;
  if (cachedWorker) idleVietnameseWorker = null;
  const worker = cachedWorker ?? new Worker(new URL("./demo-speech.worker.ts", import.meta.url));
  return new Promise((resolve, reject) => {
    const finish = (reuse = false) => {
      signal.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      if (reuse && voice === "vi" && !idleVietnameseWorker) idleVietnameseWorker = worker;
      else worker.terminate();
    };
    const onAbort = () => {
      finish();
      resolve(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<DemoSpeechResult>) => {
      finish("pcm" in data);
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.pcm);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("Could not start offline speech"));
    };
    worker.postMessage({ text, voice, gender } satisfies DemoSpeechRequest);
  });
}
