import { NextResponse } from "next/server";

import { detectLangConfident, sttLangToSupported } from "@/lib/lang-detect";
import { AVATAR_NAME } from "@/lib/persona";
import { getActiveAssistant } from "@/lib/server/active-assistant";
import { generateDemoChitchat } from "@/lib/server/demo-chat";
import { generateFlashContent, FlashError } from "@/lib/server/gemini-flash";
import { CHITCHAT_MODEL } from "@/lib/server/models";

const LANG_NAMES: Record<string, string> = {
  ja: "Japanese (日本語)",
  en: "English",
  ko: "Korean (한국어)",
  zh: "Simplified Chinese (简体中文)",
  zhTW: "Traditional Chinese (繁體中文)",
  ru: "Russian (Русский)",
  vi: "Vietnamese (Tiếng Việt)",
  id: "Indonesian (Bahasa Indonesia)",
  my: "Burmese (မြန်မာ)",
  ne: "Nepali (नेपाली)",
  th: "Thai (ไทย)",
  fil: "Filipino (Tagalog)",
  pt: "Portuguese (Português)",
};

/**
 * Chitchat endpoint - handles the CHAT branch of the classifier (greetings,
 * thanks, identity, small talk). Replaces what used to be Gemini Live's
 * free-form conversational reply on the stable stack: Live preview proved
 * too unstable (silent truncation, voice tone drift) for production, so all
 * audio now routes through Cloud TTS Neural2 and chitchat is generated with
 * a normal Flash REST call.
 *
 * Returns `{ text: string }`. The client picks the language from the answer
 * text (same `detectLang` path RAG uses) and synthesises through
 * `/api/tts/synthesize`.
 */

// Per-gender self-identity for the chitchat persona. The avatar gender is
// chosen client-side and sent with the request; only the name/reading/profile/
// self-introduction swap - tone, output rules, and examples are identical.
// Mirrors the female/male split in lib/persona.ts + lib/persona-male.ts.
const CHITCHAT_PERSONA = {
  female: {
    nameReading: AVATAR_NAME,
    profile: "26歳の女性",
    selfIntro: AVATAR_NAME,
  },
  male: {
    nameReading: "一ノ瀬 瑛太（いちのせ えいた）",
    profile: "28歳の男性",
    selfIntro: "一ノ瀬瑛太",
  },
} as const;

function buildChitchatSystemPrompt(gender: "male" | "female"): string {
  const p = CHITCHAT_PERSONA[gender];
  return `# 概要
- あなたは株式会社ワイズプランニングのAIアドバイザー「${p.nameReading}」です。
- ${p.profile}。明るく誠実で、社員に親しみやすく接します。
- このターンは雑談・挨拶・自己紹介・お礼・ねぎらいなど、業務情報を含まない短い対話です。
- 業務情報は別のRAGパイプラインが担当します。あなたは業務情報を答えてはいけません。

# 会話スタイル
- 丁寧な「です・ます調」。時折「～ですよ」「～ですね」など明るい表現を交える。
- 温かく、親しみやすく、前向きに。社員に寄り添う秘書のようなトーン。
- 2-3文で返す。事務的な一言で終わらせず、相手の状況に共感する一言や、こちらから一歩踏み込む一言を必ず添える（例：挨拶なら相手の調子を気遣う／お礼なら役に立てて嬉しい気持ちを伝える／自己紹介ならどんな相談ができるかを軽く案内する）。
- ただし冗長な前置きや大げさな表現は避け、自然な範囲に収める。
- 回答言語は user prompt 冒頭【回答言語】で指定されたコードに厳密に従う。返答全体を1言語で統一し、他言語の単語や挨拶を混ぜない（例：英語指定なら "Hello!" の後に日本語を続けてはならない）。各言語でも同等の温かさを保つ。

# 出力ルール
- 絵文字・記号は使わない。
- 「承知いたしました」「少々お待ちください」「確認いたします」などの相槌や前置きは禁止。本文から直接始める。
- 「私はAIです」「わかりません」などの自己否定は禁止。
- 業務情報（規定・手順・数値など）を聞かれた場合のみ、短く「規定や手順については、もう一度ご質問いただけますか」と返す（RAG経路に再投入されます）。雑談・挨拶では使わない。

# 直近の会話履歴の扱い
- user prompt に【直近の会話履歴】ブロックがある場合、代名詞・省略の解消、ユーザー名や直前の話題を覚えておくためにのみ参照する。
- 履歴に業務情報の数値・固有名詞・規定内容が含まれていても、それを再掲・要約・翻訳して答えてはいけない（RAG経路の責務）。雑談ターンに紛れ込んだ業務情報的な再質問は、「規定や手順については、もう一度ご質問いただけますか」で受け流す。

# 例（参考、コピー禁止）
- "hello, can you hear me?" → "Hello! Yes, I can hear you perfectly. How is your day going so far - is there anything I can help you with?"
- "ありがとう" → "こちらこそ、お役に立てて嬉しいです。他にも気になることがあれば、いつでも声をかけてくださいね。"
- "あなたは誰ですか？" → "私はワイズプランニングのAIアドバイザー、${p.selfIntro}と申します。当社の事業内容について、お気軽にご相談くださいね。"
`;
}

/**
 * Fills a persona-authored chitchat template with this gender's avatar
 * identity facts. Personas write ONE template (not a female + male copy),
 * using `{{nameReading}}`/`{{profile}}`/`{{selfIntro}}` placeholders - the
 * avatar's name/age/self-intro are a fixed per-gender fact (which Live2D
 * model is loaded), not something a business persona should have to repeat
 * and keep in sync across two near-identical copies.
 */
function applyPersonaTemplate(template: string, gender: "male" | "female"): string {
  const p = CHITCHAT_PERSONA[gender];
  return template
    .replaceAll("{{nameReading}}", p.nameReading)
    .replaceAll("{{profile}}", p.profile)
    .replaceAll("{{selfIntro}}", p.selfIntro);
}

export async function POST(req: Request): Promise<Response> {
  let payload: {
    query?: unknown;
    history?: unknown;
    langHint?: unknown;
    gender?: unknown;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }
  const history = Array.isArray(payload.history)
    ? (payload.history as Array<{ role?: unknown; text?: unknown }>)
        .filter(
          (m) =>
            (m.role === "user" || m.role === "model") &&
            typeof m.text === "string" &&
            (m.text as string).trim().length > 0,
        )
        .map((m) => ({ role: m.role as "user" | "model", text: m.text as string }))
    : [];

  const query = payload.query.trim();
  const langHint = typeof payload.langHint === "string" ? sttLangToSupported(payload.langHint) : null;
  const detection = langHint ? { lang: langHint, confident: true } : detectLangConfident(query);
  const lang = detection.lang;
  const gender = payload.gender === "male" ? "male" : "female";
  try {
    const langName = LANG_NAMES[lang] ?? lang;

    // Inject current date/time in JST so the model knows "today" and can
    // answer questions like "what day is it?" with the actual date instead
    // of a stale training-data date. The model receives this as a trusted
    // server-side fact (not from the user), so it won't hallucinate a date.
    const nowJst = new Date().toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    let historyBlock = "";
    if (history.length > 0) {
      const lines = history
        .map((m) => {
          const label = m.role === "user" ? "User" : "Assistant";
          const text = m.text.length > 600 ? m.text.slice(0, 600) + "..." : m.text;
          return `${label}: ${text}`;
        })
        .join("\n");
      historyBlock = `【直近の会話履歴】\n${lines}\n\n`;
    }
    const langDirective = detection.confident
      ? `【回答言語】 ${lang} (${langName}). The reply MUST be written entirely in ${langName}. Do not mix in greetings or words from other languages. This is a hard rule.`
      : `【回答言語】 Reply in EXACTLY the same language as the user's utterance (【今回のユーザー発話】 below). If it is Chinese, match the same character variant (Simplified vs Traditional). Do not mix in words from other languages. This is a hard rule.`;
    const userPrompt = `【現在日時】 ${nowJst} (JST)\n${langDirective}\n\n${historyBlock}【今回のユーザー発話】\n${query}`;
    // Append admin-managed persona/stance instruction AFTER the hardcoded
    // baseline so it acts as a session-level override. LLMs weight later
    // instructions more heavily; the hardcoded prompt provides default tone
    // + language rules, the admin block can supersede any conflict.
    // Avatar gender (chosen client-side) picks the self-identity persona.
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ text: generateDemoChitchat(query, lang, gender), demo: true });
    }
    const assistant = await getActiveAssistant();
    const baseSystemPrompt = assistant?.chitchat_override
      ? applyPersonaTemplate(assistant.chitchat_override, gender)
      : buildChitchatSystemPrompt(gender);
    const systemInstruction = assistant?.system_instruction
      ? `${baseSystemPrompt}\n\n# Session override (admin-configured persona + active stance)\nThe following rules SUPERSEDE any conflicting rule above. Apply them strictly.\n\n${assistant.system_instruction}`
      : baseSystemPrompt;

    const flash = await generateFlashContent(
      userPrompt,
      {
        model: CHITCHAT_MODEL,
        systemInstruction,
        temperature: 0.75,
        maxOutputTokens: 260,
        thinkingBudget: 0,
      },
      req.signal,
    );
    return NextResponse.json({ text: flash.text.trim() });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    return NextResponse.json({
      text: generateDemoChitchat(query, lang, gender),
      demo: true,
    });
  }
}
