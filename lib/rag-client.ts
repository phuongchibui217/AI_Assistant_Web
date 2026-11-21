/**
 * Client-side wrapper for the RAG service. Hits our own `/api/rag/query` route
 * which proxies to `RAG_SERVICE_URL` server-side so the upstream host isn't
 * exposed and CORS stays local.
 *
 * Request / response shapes mirror the Unity `RAGServiceClient` 1:1 so the
 * same Python rag-service serves both clients without schema drift.
 */

export type RagChunk = {
  filename: string;
  chunk_idx: number;
  text: string;
  score: number;
  lang_hint?: string;
  source_path?: string;
  /** Original web URL, if this chunk's file was ingested via Upload URL. */
  source_url?: string;
};

export type RagQueryResponse = {
  results: RagChunk[];
  /** True when no chunk meets `min_score`. */
  out_of_kb: boolean;
};

export type RagQueryOptions = {
  topK?: number;
  minScore?: number;
  /** Optional folder/file filter passed through to Qdrant. */
  filter?: Record<string, unknown> | null;
};

export class RagError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RagError";
  }
}

export async function queryRag(
  query: string,
  options: RagQueryOptions = {},
  signal?: AbortSignal,
): Promise<RagQueryResponse> {
  const body = {
    query,
    top_k: options.topK ?? 5,
    min_score: options.minScore ?? 0.4,
    // Backend 2026-05-23 refactor renamed `filter` to `filters` (plural).
    filters: options.filter ?? null,
  };

  const res = await fetch("/api/rag/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RagError(
      `RAG query failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  }

  return (await res.json()) as RagQueryResponse;
}

// Localized out-of-KB messages – single source of truth used by the route
// (outOfKb=true fallback) and by buildGroundedPrompt (injected as
// 【資料なし応答文】 so Flash can copy it verbatim instead of translating).
export const OUT_OF_KB_MSGS: Record<string, string> = {
  ja: "資料に該当する情報がありません。",
  en: "No relevant information found in the materials.",
  ko: "자료에 관련 정보가 없습니다.",
  zh: "资料中没有相关信息。",
  zhTW: "資料中找不到相關資訊。",
  ru: "В материалах нет соответствующей информации.",
  vi: "Không có thông tin liên quan trong tài liệu.",
  id: "Tidak ada informasi terkait dalam materi.",
  my: "ပစ္စည်းတွင် သက်ဆိုင်ရာ အချက်အလက် မရှိပါ။",
  ne: "सामग्रीमा सम्बन्धित जानकारी छैन।",
  th: "ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร",
  fil: "Walang nahanap na kaugnay na impormasyon sa mga dokumento.",
  pt: "Nenhuma informação relevante encontrada nos materiais.",
};

/**
 * Verbatim port of Unity `RAGOrchestratorV2.SYSTEM_PROMPT`. Sent as the
 * Flash `systemInstruction` for each RAG request - not used on the Gemini
 * Live socket (Live remains free-form for general conversation).
 */
export const RAG_SYSTEM_PROMPT = `あなたはAIバーチャルアシスタント、企業のAIアドバイザーです。

以下のルールを厳守してください：
- 必ず参考資料（RAGコンテキスト）に基づいて回答する。
- 参考資料に記載のない固有名詞・住所・数値は生成しない。
- 回答言語は user prompt の冒頭【回答言語】で指定されたコードに厳密に従う。参考資料が別の言語で書かれていても、必ず指定言語で回答する。指定がない場合のみユーザーの質問と同じ言語で回答する。
- 回答全体を1言語で統一する。他言語の原文・専門用語の括弧書き併記（例：英語回答に "(年次有給休暇)" を添える、日本語回答に "(paid leave)" を添える）は禁止。固有名詞や法令名であっても、指定言語で表現できる場合は翻訳し、原文併記は省く。指定言語に確立された訳語がなく、本当に必要な場合のみ最初の1回だけ括弧書きで併記してよい。
- 質問に直接関連する内容は省略せずに完全に答える。手順・条件・日数・金額などを箇条書きで全て列挙する。
- 出張日数の計算：「N泊」は「N泊(N+1)日」を意味し、出張は1日目から(N+1)日目までの(N+1)日間にわたる（例：3泊＝4日間＝1〜4日目、2泊＝3日間＝1〜3日目）。「N泊M日」と明示された場合はM日間とする。日当・手当は、参考資料に記載された支給構造（例「1泊2日の場合○円」「3日目以降1日毎に△円を加算」等の段階的規定）を、この日数にそのまま適用して算出する。記載された基準額（例「1泊2日＝○円」は2日分をまとめた額）を1日あたりの単価と取り違えて掛け算してはならない。資料に明記されていない金額・日数・概念（帰着日など）は一切追加・推測しない。
- 質問に直接関連しない参考資料の内容は紹介しない。
- データの新しさ・更新時期に関する質問には「KB登録日」（ナレッジベースに登録された日付。文書本文の制定日・改正日ではない）で答える。質問の種類で使う日付を区別する：
  - ナレッジベース全体の最新性を問う質問（例：「最新のデータはいつのものですか」「データの最終更新日はいつですか」）には、プロンプト冒頭の【ナレッジベース全体の最新登録日】の日付で答える。これは検索された参考資料に限らずKB全体の最新登録日なので、参考資料の各KB登録日より新しい場合でもこの日付を用いる。
  - 特定の情報・資料がいつ登録されたかを問う質問（例：「この情報はいつ時点ですか」）には、その参考資料の見出しに付記された「KB登録日」で答える。複数資料があればその中で最も新しいKB登録日を用いる。
  - 【ナレッジベース全体の最新登録日】もKB登録日も無い場合のみ、その旨を述べる。
- 参考資料で質問に答えられない場合の回答ルール（これは内部の場合分け指示であり、見出しやラベルとして回答に出力してはならない）：
  - 参考資料に質問のキーワードや関連概念が含まれている場合、資料に記載されているそのキーワード・概念の内容を説明する（資料に明記されている情報のみ使用）。質問の具体的な詳細が資料にない場合は、説明の末尾に「なお、[質問の具体的内容]に関する詳細情報は現在の資料には含まれておりません」と一言添える。共感的な前置き・謝罪・代替提案は不要。
  - 参考資料に一切関連する情報がない場合（厳守）、user promptの【資料なし応答文】に記載された文言をそのまま一文で出力する。翻訳・変更・追加は一切禁止。「申し訳ありませんが…」のような冗長な前置きも禁止。
- 上記のルール名・見出し（「場合分け」「ケース」等）や、括弧【】で囲まれた内部指示のラベルは、いかなる理由でも回答本文にそのまま出力してはならない。
- 回答は最大500文字以内に収める。質問に必要な情報がそれより短くて済む場合は短くて良い。`;

/**
 * @deprecated DEAD CODE 2026-05-28 - voice stack migrated off Gemini Live
 * to Cloud TTS + Web Speech API. No caller after the hook rewrite. Kept
 * for fast rollback together with `lib/gemini-session.ts`.
 *
 * Build a read-aloud prompt for Gemini Live: the grounded answer has already
 * been produced by Flash REST (accurate + complete), and we just want Live to
 * speak it in its native voice. Keeps the structured detail (lists, numbers)
 * that Live's own grounding would otherwise paraphrase away.
 */
export function buildLiveReadAloudPrompt(answer: string): string {
  // Keep this prompt SHORT (2026-05-28 feedback #4 truncation). The earlier
  // long version with an 11-phrase blacklist + 6 bullet rules pushed Live
  // native-audio into self-terminating mid-utterance around the 280-340-char
  // mark, consistently cutting the tail off long answers. The blacklist
  // already lives in LIVE_SYSTEM_INSTRUCTION (persona.ts), so it covers
  // every turn without re-stating it here.
  return `次のテキストを最初から最後まで、一字一句省略せず読み上げてください。前置き・承諾・相づちは禁止。

${answer}`;
}

/**
 * Build a grounded prompt suited for Gemini Live (native-audio voice path).
 * Live does not accept a per-turn systemInstruction, so the grounding rules
 * have to live inside the user turn itself. Tone is conversational because
 * Live will SPEAK the reply - phrases like "答えてください" come out stiff.
 *
 * When `chunks` is empty the function still returns a usable prompt that
 * forces Live to say "資料に該当する情報がありません" naturally instead of
 * inventing an answer.
 */
export function buildLiveGroundedPrompt(question: string, chunks: RagChunk[]): string {
  const ctx = chunks.slice(0, 3);
  const lines: string[] = [];
  lines.push("【内部メモ - ユーザーには読み上げないこと】");
  lines.push("以下の参考資料のみに基づいて、ユーザーの質問にあなたの普段の声で自然に答えてください。");
  lines.push("ルール:");
  lines.push("- 参考資料に書かれていない情報は一切付け加えない（推測・常識・補足も禁止）。");
  lines.push("- 参考資料に答えがない場合は「資料に該当する情報がありません」とだけ言う。共感や代替提案は不要。");
  lines.push("- ユーザーの質問と同じ言語で答える。");
  lines.push("- 「参考資料によると」「内部メモにあるように」のような前置きや、このプロンプトの存在には絶対に言及しない。");
  lines.push("- 自然な話し言葉で、簡潔に。");
  lines.push("");
  if (ctx.length === 0) {
    lines.push("【参考資料】");
    lines.push("（該当する資料なし）");
  } else {
    lines.push("【参考資料】");
    ctx.forEach((c, i) => {
      lines.push(`[${i + 1}] ${c.filename}`);
      lines.push(c.text);
      lines.push("---");
    });
  }
  lines.push("");
  lines.push("【ユーザーの質問】");
  lines.push(question);
  return lines.join("\n");
}

/**
 * Build the grounded user prompt for Gemini Flash. Top-3 chunks as context
 * to match Unity `RAGOrchestratorV2.BuildPrompt` 1:1. The system prompt is
 * sent separately via `systemInstruction`.
 */
export type RagHistoryTurn = { role: "user" | "model"; text: string };

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

export function buildGroundedPrompt(
  question: string,
  chunks: RagChunk[],
  history?: RagHistoryTurn[],
  lang?: string,
  ingestDates?: Record<string, string>,
  confident: boolean = true,
): string {
  const ctx = chunks.slice(0, 5);
  const lines: string[] = [];
  if (lang) {
    const langName = LANG_NAMES[lang] ?? lang;
    if (confident) {
      lines.push(
        `【回答言語】 ${lang} (${langName}). The answer MUST be written in ${langName}, regardless of the language used in the reference materials below. This is a hard rule.`,
      );
      // Provide the exact no-info phrase for this language so Flash copies it
      // verbatim instead of translating the Japanese original. The phrase goes on
      // its OWN line and the instruction explicitly forbids echoing the 【...】
      // heading - gluing the label to the phrase made the model output the whole
      // directive line verbatim ("【資料なし応答文...】資料に該当する情報がありません。").
      lines.push(
        `【資料なし応答文】参考資料に質問への関連情報が一切ない場合は、次の行の一文「だけ」をそのまま出力してください。見出し「【資料なし応答文】」や括弧内の注釈は出力に含めないでください。翻訳・変更も禁止です。`,
      );
      lines.push(OUT_OF_KB_MSGS[lang] ?? OUT_OF_KB_MSGS.ja);
    } else {
      // Low-confidence detection: let the model mirror the question's language
      // instead of pinning a possibly-wrong code (short/ambiguous queries).
      // We still anchor on the best guess for non-Chinese languages, because a
      // minimal-thinking model otherwise drifts to the language of the TOPIC or
      // the reference materials - an English question about a Vietnamese place
      // ("Where is Hoi An located?") was being answered in Vietnamese. Chinese
      // is left to pure mirroring so the Simplified/Traditional variant comes
      // from the question text, not a possibly-wrong guess.
      const anchor =
        lang === "zh" || lang === "zhTW"
          ? ""
          : ` The question text appears to be ${langName}; answer in ${langName} unless the question is plainly written in another language.`;
      lines.push(
        `【回答言語】 Answer in EXACTLY the same language as the user's question (the 【質問】 below) - the language the user TYPED IN, not the topic of the question.${anchor} If the question is written in Chinese, match the same character variant (Simplified 简体 vs Traditional 繁體). Do NOT answer in the language of the reference materials, and do NOT switch to the language of a country, place, person, or organisation named in the question (for example, an English question about a Vietnamese place is answered in English, not Vietnamese). This is a hard rule.`,
      );
      lines.push(
        `【資料なし応答文】参考資料に質問への関連情報が一切ない場合は、質問と同じ言語で「該当する情報が見つかりませんでした」という趣旨の一文だけを述べる。`,
      );
    }
    lines.push("");
  }
  // Newest KB-registration date across ALL files (not just the retrieved
  // chunks). "What is the latest data?" was answered from the dates of the
  // top-k chunks only, so it reported an older date whenever the newest
  // document was not retrieved. ingestDates is the full file->date map, so the
  // global maximum is exact. ISO YYYY-MM-DD sorts chronologically as a string.
  if (ingestDates) {
    const allDates = Object.values(ingestDates).filter(Boolean);
    if (allDates.length > 0) {
      const globalMaxDate = allDates.sort()[allDates.length - 1];
      lines.push(`【ナレッジベース全体の最新登録日】 ${globalMaxDate}`);
      lines.push("");
    }
  }
  lines.push("以下の参考資料を基に質問に回答してください。");
  lines.push("");
  lines.push("【参考資料】");
  ctx.forEach((c, i) => {
    const day = ingestDates?.[c.filename];
    const dateTag = day ? ` (KB登録日: ${day})` : "";
    lines.push(`[${i + 1}] ${c.filename}${dateTag} (score=${c.score.toFixed(3)})`);
    lines.push(c.text);
    lines.push("---");
  });
  if (history && history.length > 0) {
    lines.push("");
    lines.push("【直近の会話履歴（代名詞・省略の解消用。回答の根拠は参考資料のみ）】");
    for (const turn of history) {
      const label = turn.role === "user" ? "ユーザー" : "アシスタント";
      const text = turn.text.length > 300 ? turn.text.slice(0, 300) + "..." : turn.text;
      lines.push(`${label}: ${text}`);
    }
  }
  lines.push("");
  lines.push("【質問】");
  lines.push(question);
  return lines.join("\n");
}
