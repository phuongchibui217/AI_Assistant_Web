import type { Citation } from "@/lib/citations";
import { detectLang, type SupportedLang } from "../lang-detect";
import { AVATAR_NAME } from "../persona";
import { AVATAR_NAME_MALE } from "../persona-male";
import { createInitialDemoState, readDemoStore, type DemoFile } from "./demo-store";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/đ/g, "d");
}

const CHAT_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye|xin chao|chao|cam on|tam biet|ban la ai|ten ban la gi|who are you|what is your name|how are you|ban khoe khong|hom nay|may gio)\b/i;
const CJK_CHAT_PATTERN = /^(こんにちは|こんばんは|おはよう|ありがとう|あなたは誰|お名前|你好|您好|谢谢|謝謝|你是谁|你是誰|再见|再見)/u;

export function classifyQueryLocal(query: string): "CHAT" | "KB" {
  const norm = normalize(query.trim());
  if (norm.length <= 45 && (CHAT_PATTERN.test(norm) || CJK_CHAT_PATTERN.test(norm))) {
    return "CHAT";
  }
  if (
    /\b(ban la ai|who are you|gioi thieu|tu gioi thieu|ban ten (?:la )?gi|cam on|thank|xin chao|hello|hi there|chao ban)\b/i.test(
      norm,
    )
  ) {
    return "CHAT";
  }
  return "KB";
}

export function generateDemoChitchat(
  query: string,
  lang: string,
  gender: "male" | "female",
): string {
  const norm = normalize(query);
  const name = gender === "female" ? AVATAR_NAME : AVATAR_NAME_MALE;

  const isThanks = /cam on|thank|ありがとう|谢谢|謝謝/.test(norm);
  const isIdentity = /ban la ai|who are you|(?:ban ten|ten ban) (?:la )?gi|what is your name|gioi thieu|あなたは誰|お名前|你是谁|你是誰/.test(norm);

  if (lang === "en") {
    if (isThanks) {
      return "You're very welcome! I'm always happy to help. Let me know if you have any other questions about company policies or documents.";
    }
    if (isIdentity) {
      return `I am ${name}, your enterprise AI Virtual Assistant. You can ask me about HR policies, probation periods, architecture guides, or any document uploaded to the Knowledge Base.`;
    }
    return `Hello! I'm ${name}. How can I assist you today? Feel free to ask about our Employee Handbook, Product Architecture, FAQ, or Q3 Financial Report.`;
  }

  if (lang === "ja") {
    if (isThanks) {
      return "こちらこそ、お役に立てて嬉しいです。社内規定やドキュメントについて他にも気になることがあれば、いつでもお聞きくださいね。";
    }
    if (isIdentity) {
      return `私はAIバーチャルアシスタントの${name}です。社内規定、製品アーキテクチャ、財務レポートなどナレッジベースに登録された資料についてお答えします。`;
    }
    return `こんにちは！${name}です。今日はどのようなご用件でしょうか？社内規定や業務資料についてお気軽にご質問ください。`;
  }

  if (lang === "zhTW") {
    if (isThanks) return "不客氣！很高興能幫到您。有其他問題也歡迎隨時詢問。";
    if (isIdentity) return `您好，我是企業虛擬助理${name}。我可以幫您查詢員工手冊、系統架構和財務報告。`;
    return `您好，我是${name}！今天有什麼可以幫您的嗎？`;
  }

  if (lang === "zh") {
    if (isThanks) {
      return "不客气，很高兴能帮到您！如果对公司规章制度或知识库文档还有其他问题，随时都可以问我。";
    }
    if (isIdentity) {
      return `您好，我是企业虚拟助手${name}。我可以为您解答员工手册、系统架构、常见问题及财务报告等知识库相关问题。`;
    }
    return "您好！请问今天有什么可以帮您的？您可以随时向我咨询员工手册、产品架构或财务报告等内容。";
  }

  // Vietnamese (default for demo)
  if (isThanks) {
    return "Không có gì ạ, rất vui được hỗ trợ bạn! Nếu cần tra cứu thêm quy định công ty hay tài liệu nội bộ nào khác, bạn cứ hỏi mình nhé.";
  }
  if (isIdentity) {
    return `Chào bạn, mình là ${name} — trợ lý ảo tra cứu tri thức nội bộ. Bạn có thể hỏi mình về quy định thử việc, giờ làm việc, kiến trúc hệ thống, dịch vụ hoặc các tài liệu vừa tải lên Kho tri thức nhé.`;
  }
  return `Xin chào! Mình là ${name}. Bạn cần tra cứu thông tin gì hôm nay ạ? Bạn có thể thử hỏi về thời gian thử việc, kiến trúc hệ thống, dịch vụ AI Mind hoặc báo cáo tài chính Quý 3/2026.`;
}

const TOPIC_HINTS: Array<{ match: RegExp; fileHint: RegExp }> = [
  {
    match: /thu viec|probation|gio lam|working hour|nghi phep|leave|so tay|handbook|nhan vien|bao hiem|employee|規定|試用|休暇|勤務時間|员工|員工|试用|工作時間/,
    fileHint: /handbook|employee/i,
  },
  {
    match: /kien truc|architecture|qdrant|celery|gemini|three\.?js|rag|vector|cong nghe|he thong|stt|lip.?sync|アーキテクチャ|架构|架構/,
    fileHint: /architecture|product/i,
  },
  {
    match: /dich vu|service|ai mind|aimind|tru cot|fintech|faq|hotline|ho tro|support|サービス|服务|服務|支援/,
    fileHint: /faq|customer/i,
  },
  {
    match: /doanh thu|revenue|tai chinh|financial|quy 3|q3|r&d|ngan sach|budget|売上|財務|营收|營收|财务/,
    fileHint: /financial|report/i,
  },
];

const INITIAL_DEMO_FILES = createInitialDemoState().files;

// Localized excerpts for the bundled documents. Use them only when the
// stored source matches the original, so edits and uploads keep their own data.
const DEMO_EXCERPTS: Partial<Record<string, Partial<Record<SupportedLang, string>>>> = {
  "Employee_Handbook_2026.pdf": {
    en: "Section 3.2 of the employee handbook sets a two-month probation period for new technical staff. Working hours are 8:00 a.m. to 5:30 p.m., Monday through Friday, with a lunch break from noon to 1:30 p.m. Confirmed employees get 12 days of paid annual leave and full health insurance from their first day of employment.",
    vi: "Theo mục 3.2 của sổ tay nhân viên, thời gian thử việc tiêu chuẩn cho nhân viên kỹ thuật mới là 2 tháng. Giờ làm việc từ 8:00 đến 17:30, từ thứ Hai đến thứ Sáu. Giờ nghỉ trưa từ 12:00 đến 13:30. Nhân viên chính thức được hưởng 12 ngày nghỉ phép năm có lương và đầy đủ bảo hiểm y tế từ ngày đầu làm việc.",
    ja: "社員ハンドブックの第3.2節では、新入技術職の試用期間は2か月です。勤務時間は月曜から金曜の8時から17時30分までで、昼休みは12時から13時30分までです。正社員には年12日の有給休暇があり、入社初日から医療保険が適用されます。",
    zhTW: "根據員工手冊第 3.2 節，新進技術人員的試用期為兩個月。上班時間為週一至週五上午 8 點至下午 5 點半，午休為中午 12 點至下午 1 點半。正式員工每年享有 12 天有薪年假，並自入職首日起享有完整的醫療保險。",
  },
  "Product_Architecture_Guide.docx": {
    en: "The AI Virtual Assistant uses Next.js and Three.js to render 2D and 3D avatars with real-time lip sync. Celery workers handle background tasks, Qdrant provides vector search using HNSW, and Gemini Flash generates answers with source citations through retrieval-augmented generation.",
    ja: "AIバーチャルアシスタントは、Next.jsとThree.jsを使って、リアルタイムのリップシンクに対応した2D・3Dアバターを表示します。バックグラウンド処理にはCelery、ベクトル検索にはQdrantのHNSWを使います。Gemini FlashはRAGで検索した資料に基づき、出典付きで回答します。",
    zhTW: "AI 虛擬助理使用 Next.js 和 Three.js 顯示具即時嘴型同步的 2D 與 3D 角色。Celery 處理背景工作，Qdrant 透過 HNSW 執行向量搜尋，Gemini Flash 結合檢索增強生成來提供附有來源的回答。",
  },
  "Customer_FAQ_Policy.html": {
    en: "AI Mind offers enterprise AI platforms, fintech AI solutions, conversational and voice AI for multilingual virtual assistants, and computer vision and robotics. Technical support is available around the clock.",
    ja: "AI Mindは、企業向けAIプラットフォーム、金融向けAIソリューション、多言語音声アシスタント向けの対話・音声AI、コンピュータービジョンとロボティクスを提供しています。技術サポートは24時間365日対応しています。",
    zhTW: "AI Mind 提供企業 AI 平台、金融科技 AI 解決方案、用於多語言虛擬助理的對話與語音 AI，以及電腦視覺與機器人技術。技術支援全天候提供服務。",
  },
  "Financial_Report_Q3_2026.xlsx": {
    en: "In the third quarter of 2026, revenue grew 38 percent year over year. The research and development budget was 1.2 million US dollars, focused on vector databases and interactive virtual assistant devices.",
    vi: "Trong quý 3 năm 2026, doanh thu tăng 38% so với cùng kỳ năm trước. Ngân sách nghiên cứu và phát triển đạt 1,2 triệu USD, tập trung vào cơ sở dữ liệu vector và thiết bị trợ lý ảo giao tiếp.",
    ja: "2026年第3四半期の売上は、前年同期比で38％増加しました。研究開発予算は120万米ドルで、ベクトルデータベースと対話型アシスタント機器に重点を置いています。",
    zhTW: "2026 年第三季營收較去年同期成長 38%。研發預算為 120 萬美元，主要投入向量資料庫與互動式虛擬助理裝置。",
  },
};

function scoreFile(query: string, file: DemoFile): number {
  const qNorm = normalize(query);
  const haystack = normalize(`${file.filename} ${file.folder} ${file.rawContent ?? ""}`);
  let score = 0;

  for (const hint of TOPIC_HINTS) {
    if (hint.match.test(qNorm) && hint.fileHint.test(file.filename)) {
      score += 10;
    }
  }

  const tokens = qNorm
    .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/)
    .filter((t) => t.length >= 2);
  for (const tok of tokens) {
    if (haystack.includes(tok)) {
      score += tok.length >= 4 ? 3 : 1;
    }
  }
  return score;
}

export function searchDemoKnowledgeBase(
  query: string,
  lang: SupportedLang,
): { answer: string; answerLang: SupportedLang; citations: Citation[]; outOfKb: boolean } {
  const store = readDemoStore();
  const readyFiles = store.files.filter((f) => !f.deleted && f.status === "done" && f.rawContent?.trim());

  let best: DemoFile | null = null;
  let bestScore = 0;
  for (const file of readyFiles) {
    const s = scoreFile(query, file);
    if (s > bestScore) {
      bestScore = s;
      best = file;
    }
  }

  if (!best || bestScore < 3) {
    const outMsg: Record<string, string> = {
      vi: "Hiện chưa tìm thấy thông tin liên quan trong Kho tri thức nội bộ. Bạn có thể kiểm tra lại từ khóa hoặc tải thêm tài liệu vào mục Knowledge Base trong trang Quản trị nhé.",
      en: "No relevant information was found in the uploaded Knowledge Base materials. Try asking about the Employee Handbook, Product Architecture, Customer FAQ, or Q3 Financial Report.",
      ja: "ナレッジベースに該当する資料が見つかりませんでした。社員ハンドブックや製品アーキテクチャ、財務レポートについてお試しください。",
      zh: "当前知识库中未找到相关信息。您可以尝试询问员工手册、产品架构、常见问题或财务报告等内容。",
      zhTW: "目前在知識庫中找不到相關資訊。您可以試著詢問員工手冊、系統架構、常見問題或財務報告。",
    };
    return {
      answer: outMsg[lang] ?? outMsg.vi,
      answerLang: outMsg[lang] ? lang : "vi",
      citations: [],
      outOfKb: true,
    };
  }

  const citation: Citation = {
    filename: best.filename,
    score: Math.min(0.99, 0.72 + bestScore * 0.02),
    sourcePath: `${best.folder}/${best.filename}`,
    sourceUrl: best.sourceUrl,
  };

  const match = best;
  const excerpt = (match.rawContent ?? "").trim();
  const isBundled = INITIAL_DEMO_FILES.some(
    (file) => file.id === match.id && file.filename === match.filename &&
      file.folder === match.folder && file.rawContent === excerpt,
  );
  const localized = isBundled ? DEMO_EXCERPTS[match.filename] : undefined;
  const sourceLang = isBundled ? "vi" : detectLang(excerpt);
  const result = { citations: [citation], outOfKb: false };

  const localAnswer = localized?.[lang];
  if (localAnswer) return { ...result, answer: localAnswer, answerLang: lang };
  const missingTranslation: Partial<Record<SupportedLang, string>> = {
    en: "I found a matching document. An English version of this document is unavailable in the demo. You can open the source below.",
    vi: "Mình tìm thấy tài liệu phù hợp. Bản demo chưa có nội dung tiếng Việt cho tài liệu này. Bạn có thể mở tài liệu ở bên dưới.",
    ja: "関連する資料が見つかりました。デモではこの資料の日本語版を表示できません。下のリンクから元の資料をご覧ください。",
    zhTW: "已找到相關文件。此示範版尚無該文件的繁體中文內容，您可從下方連結查看原文。",
  };
  const notice = missingTranslation[lang];
  if (lang !== sourceLang && notice) return { ...result, answer: notice, answerLang: lang };
  return { ...result, answer: excerpt, answerLang: sourceLang };
}

export function generateDemoSuggestions(lang: string): string[] {
  if (lang === "en") {
    return [
      "What is the probation period and working hours?",
      "What technologies power the system architecture?",
      "What was the Q3 2026 financial revenue growth?",
    ];
  }
  if (lang === "ja") {
    return [
      "試用期間と勤務時間について教えて",
      "システムアーキテクチャの技術構成は？",
      "2026年第3四半期の売上成長率は？",
    ];
  }
  if (lang === "zhTW") {
    return ["試用期和上班時間是多久？", "系統架構使用了哪些核心技術？", "2026 年第三季營收成長了多少？"];
  }
  if (lang === "zh") {
    return [
      "公司的试用期和工作时间是多少？",
      "系统架构使用了哪些核心技术？",
      "2026年第三季度营收增长了多少？",
    ];
  }
  return [
    "Quy định thời gian thử việc và giờ làm việc?",
    "Kiến trúc hệ thống dùng những công nghệ gì?",
    "Doanh thu Quý 3 năm 2026 tăng trưởng bao nhiêu?",
  ];
}
