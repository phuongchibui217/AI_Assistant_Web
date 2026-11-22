import type { SupportedLang } from "@/lib/lang-detect";

type TranslationPair = { sourceLanguage: string; targetLanguage: string };
type BrowserTranslator = {
  translate(text: string, options: { signal: AbortSignal }): Promise<string>;
};
type BrowserTranslatorAPI = {
  create(pair: TranslationPair): Promise<BrowserTranslator>;
};

const DEMO_PHRASES: ReadonlyArray<Partial<Record<SupportedLang, string>>> = [
  { vi: "Xin chào!", en: "Hello!", ja: "こんにちは！", zh: "你好！", zhTW: "你好！" },
  { vi: "Chào bạn!", en: "Hi!", ja: "やあ！", zh: "嗨！", zhTW: "嗨！" },
  { vi: "Cảm ơn!", en: "Thank you!", ja: "ありがとうございます！", zh: "谢谢！", zhTW: "謝謝！" },
  { vi: "Chào buổi sáng!", en: "Good morning!", ja: "おはようございます！", zh: "早上好！", zhTW: "早上好！" },
  { vi: "Bạn khỏe không?", en: "How are you?", ja: "お元気ですか？", zh: "你好吗？", zhTW: "你好嗎？" },
  { vi: "Bạn tên là gì?", en: "What's your name?", ja: "お名前は何ですか？", zh: "你叫什么名字？", zhTW: "你叫什麼名字？" },
  { vi: "Rất vui được gặp bạn.", en: "Nice to meet you.", ja: "はじめまして。", zh: "很高兴见到你。", zhTW: "很高興見到你。" },
  { vi: "Hẹn gặp lại!", en: "See you later!", ja: "また会いましょう！", zh: "回头见！", zhTW: "回頭見！" },
];

function normalizePhrase(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase()
    .replace(/’/g, "'").replace(/\s+/g, " ").replace(/[.!?,。]+$/u, "");
}

const translators = new Map<string, Promise<BrowserTranslator | null>>();

export async function prepareBrowserTranslator(source: SupportedLang, target: SupportedLang) {
  const api = (globalThis as typeof globalThis & { Translator?: BrowserTranslatorAPI }).Translator;
  if (!api || source === target) return null;
  const key = `${source}:${target}`;
  const existing = translators.get(key);
  if (existing) return existing;

  const pending = (async () => api.create({
    sourceLanguage: source === "zhTW" ? "zh-Hant" : source,
    targetLanguage: target === "zhTW" ? "zh-Hant" : target,
  }))().catch(() => {
    translators.delete(key);
    return null;
  });
  translators.set(key, pending);
  return pending;
}

export function prepareLocalTranslation(text: string, source: SupportedLang, target: SupportedLang) {
  const normalized = normalizePhrase(text);
  const sample = DEMO_PHRASES.find((phrase) => {
    const original = phrase[source];
    return original && normalizePhrase(original) === normalized;
  })?.[target];
  // Start creation before any other await so a first download can use the
  // user gesture that submitted the message.
  const pending = sample ? null : prepareBrowserTranslator(source, target);

  return async (signal: AbortSignal): Promise<string | null> => {
    signal.throwIfAborted();
    if (sample) return sample;
    const translator = await pending;
    signal.throwIfAborted();
    return (await translator?.translate(text, { signal }))?.trim() || null;
  };
}
