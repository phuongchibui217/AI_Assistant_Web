import type { Citation } from "@/lib/citations";
import { detectLang, type SupportedLang } from "../lang-detect";
import { AVATAR_NAME } from "../persona";
import { createInitialDemoState, readDemoStore, type DemoFile } from "./demo-store";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

const CHAT_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye|xin chao|chao|cam on|tam biet|ban la ai|ten ban la gi|who are you|what is your name|how are you|ban khoe khong|hom nay|may gio|こんにちは|こんばんは|おはよう|ありがとう|あなたは誰|你好|谢谢|你是谁|再见)\b/i;

export function classifyQueryLocal(query: string): "CHAT" | "KB" {
  const norm = normalize(query.trim());
  if (norm.length <= 45 && CHAT_PATTERN.test(norm)) {
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
  const maleName = lang === "ja" ? "一ノ瀬 瑛太" : "Minh";
  const name = gender === "female" ? AVATAR_NAME : maleName;

  const isThanks = /cam on|thank|ありがとう|谢谢|謝謝/.test(norm);
  const isIdentity = /ban la ai|who are you|(?:ban ten|ten ban) (?:la )?gi|what is your name|gioi thieu|あなたは誰|你是谁/.test(norm);

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

  if (lang === "zh" || lang === "zhTW") {
    if (isThanks) {
      return "不客气，很高兴能帮到您！如果对公司规章制度或知识库文档还有其他问题，随时都可以问我。";
    }
    if (isIdentity) {
      return `您好，我是企业虚拟助手。我可以为您解答员工手册、系统架构、常见问题及财务报告等知识库相关问题。`;
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
    match: /thu viec|probation|gio lam|working hour|nghi phep|leave|so tay|handbook|nhan vien|bao hiem|employee|規定|試用|休暇|员工|试用/,
    fileHint: /handbook|employee/i,
  },
  {
    match: /kien truc|architecture|qdrant|celery|gemini|three\.?js|rag|vector|cong nghe|he thong|stt|lip.?sync|アーキテクチャ|架构/,
    fileHint: /architecture|product/i,
  },
  {
    match: /dich vu|service|ai mind|aimind|tru cot|fintech|faq|hotline|ho tro|support|サービス|服务/,
    fileHint: /faq|customer/i,
  },
  {
    match: /doanh thu|revenue|tai chinh|financial|quy 3|q3|r&d|ngan sach|budget|財務|营收|财务/,
    fileHint: /financial|report/i,
  },
];

const INITIAL_DEMO_FILES = createInitialDemoState().files;

// Localized excerpts for the bundled documents. Use them only when the
// stored source matches the original, so edits and uploads keep their own data.
const DEMO_EXCERPTS: Partial<Record<string, { en: string; vi?: string }>> = {
  "Employee_Handbook_2026.pdf": {
    en: "Section 3.2 of the employee handbook sets a two-month probation period for new technical staff. Working hours are 8:00 a.m. to 5:30 p.m., Monday through Friday, with a lunch break from noon to 1:30 p.m. Confirmed employees get 12 days of paid annual leave and full health insurance from their first day of employment.",
    vi: "Theo mục 3.2 của sổ tay nhân viên, thời gian thử việc tiêu chuẩn cho nhân viên kỹ thuật mới là 2 tháng. Giờ làm việc từ 8:00 đến 17:30, từ thứ Hai đến thứ Sáu. Giờ nghỉ trưa từ 12:00 đến 13:30. Nhân viên chính thức được hưởng 12 ngày nghỉ phép năm có lương và đầy đủ bảo hiểm y tế từ ngày đầu làm việc.",
  },
  "Product_Architecture_Guide.docx": {
    en: "The AI Virtual Assistant uses Next.js and Three.js to render 2D and 3D avatars with real-time lip sync. Celery workers handle background tasks, Qdrant provides vector search using HNSW, and Gemini Flash generates answers with source citations through retrieval-augmented generation.",
  },
  "Customer_FAQ_Policy.html": {
    en: "AI Mind offers enterprise AI platforms, fintech AI solutions, conversational and voice AI for multilingual virtual assistants, and computer vision and robotics. Technical support is available around the clock.",
  },
  "Financial_Report_Q3_2026.xlsx": {
    en: "In the third quarter of 2026, revenue grew 38 percent year over year. The research and development budget was 1.2 million US dollars, focused on vector databases and interactive virtual assistant devices.",
    vi: "Trong quý 3 năm 2026, doanh thu tăng 38% so với cùng kỳ năm trước. Ngân sách nghiên cứu và phát triển đạt 1,2 triệu USD, tập trung vào cơ sở dữ liệu vector và thiết bị trợ lý ảo giao tiếp.",
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

  if (lang === "en" && sourceLang !== "en") {
    const answer = localized?.en ?? "I found a matching document. An English version of this document is unavailable in the demo. You can open the source below.";
    return { ...result, answer, answerLang: "en" };
  }
  if (lang === "vi" && sourceLang !== "vi") {
    const answer = "Mình tìm thấy tài liệu phù hợp. Bản demo chưa có nội dung tiếng Việt cho tài liệu này. Bạn có thể mở tài liệu ở bên dưới.";
    return { ...result, answer, answerLang: "vi" };
  }
  return { ...result, answer: localized?.vi ?? excerpt, answerLang: sourceLang };
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
  if (lang === "zh" || lang === "zhTW") {
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
