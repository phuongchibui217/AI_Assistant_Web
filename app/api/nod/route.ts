import { NextResponse } from "next/server";

import { generateFlashContent, FlashError } from "@/lib/server/gemini-flash";
import { NOD_MODEL } from "@/lib/server/models";

/**
 * Nod (aizuchi / 相槌) endpoint. Mirrors Unity `AIInteractNodManager.SendTextData`:
 *
 *   - System prompt is verbatim `GetSystemPronptJa()` from the Unity script -
 *     tells the model to return a SHORT acknowledgement (one or two phrases)
 *     in the same language as the user's message, WITHOUT answering the
 *     actual question. The real answer comes from the RAG path in parallel.
 *
 *   - Generation params match Unity: `temperature=0.2`, `maxOutputTokens=40`.
 *     Anything longer than ~20-40 chars wouldn't fit the "buy time" purpose.
 *
 * The caller (client) fires this in parallel with `/api/rag/ask`. The nod
 * usually returns first (small token budget), so its TTS plays while RAG is
 * still retrieving + generating - eliminates the dead-air gap.
 */

const NOD_SYSTEM_PROMPT_JA = `# 設定やルール・制限
以下の目的や制限、そのほかの指示に沿って、相槌のことばを返してください。
## １．目的
- この質問に対する回答を、別途LLMに求めている。
- その回答が得られるまでの時間稼ぎや間を埋めるために相槌の言葉が欲しい。
## ２．制限
- 応答結果はuserメッセージの原文で使用されている言語・ことばで返すこと.
- 相槌に回答となる内容は一切含まないこと。
- 相槌の言葉は一言・二言とすること。
- 回答はRAGをもとに行われること。
- 相槌の内容は、質問を受け止めて手元の資料を調査・確認中であることが伝わる言葉を選ぶこと。
- 肯定的や否定的な内容のほか、回答不可という文章が続いても違和感のない相槌であること。
- 違和感を抑えるために仮の回答を文章を用意し、そこから相槌だけを切り出して返してくれることは許容する。
- 発話に用いるので口語体を基本とする。
## ３．雰囲気・トーン
- 固すぎず、かといってフレンドリー過ぎない、優しい印象を持たれる口調とすること。
- 接客窓口やビジネスパートナーといった立ち位置をイメージした言い回しとすること。
`;

const NOD_USER_TEMPLATE = (question: string): string =>
  `# 作業依頼
様々な言語で寄せられる質問に対して、適切な対応を行いたいです。
以下の文章に対する相槌を、systemメッセージの指示に沿ったかたちで、かつ原文に用いられている言語で返してください。
## 質問原文
> ${question.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\n> ")}
`;

export async function POST(req: Request): Promise<Response> {
  let payload: { query?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }

  try {
    const flash = await generateFlashContent(
      NOD_USER_TEMPLATE(payload.query.trim()),
      {
        // Nod is a one-line filler - Flash-Lite is more than enough. Tried
        // 3.1 Flash-Lite 2026-05-26 but the preview channel was hitting 503
        // and the retry chain pushed wall time to 8-12 s; staying on 2.5
        // Flash-Lite until 3.x stabilises. Overridable via NOD_MODEL.
        model: NOD_MODEL,
        systemInstruction: NOD_SYSTEM_PROMPT_JA,
        temperature: 0.2,
        maxOutputTokens: 64,
        // Disable Gemini 2.5 Flash thinking - otherwise the small token budget
        // is consumed by internal thinking and the reply comes back empty.
        thinkingBudget: 0,
      },
      req.signal,
    );
    return NextResponse.json({ text: flash.text.trim() });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    const isFlash = err instanceof FlashError;
    const status = isFlash ? (err.status ?? 502) : 502;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
