import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";

export type DemoLang = "vi" | "en" | "ja" | "zh";

export interface DemoAssistant {
  id: number;
  name: Record<DemoLang, string>;
  version: string;
  state: number;
  persona: string;
}

export interface DemoStance {
  id: number;
  assistantId: number;
  name: Record<DemoLang, string> | string;
  version: string;
  tone: Record<DemoLang, string> | string;
  attitude: Record<DemoLang, string> | string;
  lexicon: Record<DemoLang, string> | string;
  precision: Record<DemoLang, string> | string;
  boundaries: Record<DemoLang, string> | string;
  state: number;
}

export interface DemoFile {
  id: number;
  filename: string;
  size: string;
  sizeBytes: number;
  status: "pending" | "processing" | "done" | "failed" | "not_indexed";
  updated: string;
  folder: string;
  sourceUrl?: string;
  rawContent?: string;
  deleted?: boolean;
}

export interface DemoLexeme {
  id: number;
  grapheme: string;
  type: "Phoneme" | "Alias";
  phoneme: string;
  state: number;
}

export interface DemoChatRecord {
  id: number;
  sessionId: string;
  source: string;
  question: string;
  answer: string;
  questionAt: string;
  answerAt: string;
  deleted?: boolean;
}

export interface DemoBackground {
  id: number;
  name: string;
  filename: string;
  url: string;
  active: boolean;
}

export interface DemoStoreState {
  assistants: DemoAssistant[];
  stances: DemoStance[];
  files: DemoFile[];
  lexemes: DemoLexeme[];
  chatRecords: DemoChatRecord[];
  backgrounds: DemoBackground[];
  clientUsername?: string;
  clientPasswordHash?: string;
  clientPassword?: string;
}

const DEMO_DATA_FILE = path.join(process.cwd(), "demo-data.json");

export function createInitialDemoState(): DemoStoreState {
  return {
    assistants: [
      {
        id: 1,
        name: {
          vi: "Trợ lý Nội bộ Doanh nghiệp (Mặc định cũ)",
          en: "Internal Corporate Assistant (Legacy Default)",
          ja: "社内アシスタント（旧デフォルト）",
          zh: "企业内部助手（旧默认）",
        },
        version: "1.0.0",
        state: 0,
        persona: '{\n  "identity": "Internal Corporate Advisor",\n  "style": "Formal & Courteous"\n}',
      },
      {
        id: 2,
        name: {
          vi: "Hướng dẫn viên Dịch vụ & Khách hàng",
          en: "Customer Support & Service Guide",
          ja: "ワイズプランニング事業案内",
          zh: "客户服务导览助手",
        },
        version: "1.0.0",
        state: 0,
        persona: '{\n  "identity": "Customer Service Guide",\n  "style": "Polite & Helpful"\n}',
      },
      {
        id: 3,
        name: {
          vi: "Cố vấn AI Đa năng (Tổng quát)",
          en: "General AI Advisor",
          ja: "ワイズプランニング AIアドバイザー（汎用）",
          zh: "通用型 AI 顾问",
        },
        version: "1.0.0",
        state: 0,
        persona: '{\n  "identity": "General Knowledge Advisor",\n  "style": "Friendly & Precise"\n}',
      },
      {
        id: 5,
        name: {
          vi: "Trợ lý AI chính thức (Đang hoạt động)",
          en: "AI Virtual Assistant (Active Production)",
          ja: "本番用 AI アシスタント（稼働中）",
          zh: "正式运营 AI 助手 (启用中)",
        },
        version: "1.0.0",
        state: 1,
        persona: '{\n  "identity": "Primary Production Advisor",\n  "style": "Accurate & Grounded"\n}',
      },
    ],
    stances: [
      {
        id: 1,
        assistantId: 1,
        name: {
          vi: "Phong cách chuẩn mực",
          en: "Standard Stance",
          ja: "基本姿勢",
          zh: "基本姿态",
        },
        version: "1.0.0",
        tone: {
          vi: "Lịch thiệp, trang trọng và chuẩn mực",
          en: "Courteous, formal and standard",
          ja: "礼儀正しく、フォーマルで標準的",
          zh: "谦逊有礼、庄重且规范",
        },
        attitude: {
          vi: "Tận tình, điềm tĩnh và chuyên nghiệp",
          en: "Supportive, calm and professional",
          ja: "親切で落ち着いたプロの対応",
          zh: "竭诚协助、沉着且专业",
        },
        lexicon: {
          vi: "Thuật ngữ chuẩn xác, câu từ gãy gọn nhã nhặn",
          en: "Standard corporate terminology, polite sentence endings",
          ja: "ビジネス専門用語と丁寧な語尾表現",
          zh: "精确的企业专业用语，言词精炼典雅",
        },
        precision: {
          vi: "Độ chính xác cao, trả lời súc tích trong 3 câu trừ khi được yêu cầu chi tiết",
          en: "High precision, concise answers under 3 sentences unless asked",
          ja: "高精度、詳細を求められない限り3文以内で簡潔に回答",
          zh: "高精度，除非要求详解否则控制在3句以内",
        },
        boundaries: {
          vi: "Chỉ trả lời dựa trên tài liệu đã xác minh; từ chối suy đoán nội dung ngoài kho tri thức",
          en: "Strictly answer within verified company documentation; refuse unsupported factual generation",
          ja: "検証済み資料に厳密に基づき回答。ナレッジベース外の憶測を拒否",
          zh: "严格依据已验证文件回答；拒绝臆测知识库以外的内容",
        },
        state: 1,
      },
    ],
    files: [
      {
        id: 1,
        filename: "Employee_Handbook_2026.pdf",
        size: "2.4 MB",
        sizeBytes: 2516582,
        status: "done",
        updated: "2026-10-28 14:20",
        folder: "root",
        rawContent:
          "Section 3.2: Thời gian thử việc tiêu chuẩn cho nhân viên kỹ thuật mới là 02 tháng (The standard probation period for new technical employees is 2 months). Giờ làm việc chính thức từ 08:00 đến 17:30 từ Thứ Hai đến Thứ Sáu, nghỉ trưa 12:00–13:30. Nhân viên chính thức được hưởng 12 ngày nghỉ phép năm có lương và đầy đủ bảo hiểm y tế ngay từ ngày đầu làm việc.",
      },
      {
        id: 2,
        filename: "Product_Architecture_Guide.docx",
        size: "1.1 MB",
        sizeBytes: 1153433,
        status: "done",
        updated: "2026-10-29 09:15",
        folder: "root",
        rawContent:
          "Kiến trúc hệ thống AI Virtual Assistant sử dụng Next.js + Three.js cho giao diện nhân vật 2D/3D nhép miệng thời gian thực, Celery worker bất đồng bộ, tìm kiếm vector Qdrant HNSW và mô hình ngôn ngữ Gemini Flash kết hợp RAG trích dẫn nguồn minh bạch.",
      },
      {
        id: 3,
        filename: "Customer_FAQ_Policy.html",
        size: "340 KB",
        sizeBytes: 348160,
        status: "done",
        updated: "2026-10-30 16:45",
        folder: "root",
        sourceUrl: "https://aimind.vn/faq",
        rawContent:
          "Q: AI Mind cung cấp những dịch vụ gì? A: 4 trụ cột chính gồm Enterprise AI Platform, Fintech AI Solutions, Conversational & Voice AI (trợ lý ảo giọng nói đa ngôn ngữ) và Computer Vision & Robotics. Hotline hỗ trợ kỹ thuật hoạt động 24/7.",
      },
      {
        id: 4,
        filename: "Financial_Report_Q3_2026.xlsx",
        size: "820 KB",
        sizeBytes: 839680,
        status: "done",
        updated: "2026-10-31 11:10",
        folder: "finance",
        rawContent:
          "Báo cáo tài chính Quý 3 năm 2026: Doanh thu tăng trưởng 38% so với cùng kỳ năm trước (Q3 2026 revenue increased 38% year-over-year). Ngân sách đầu tư R&D đạt 1,2 triệu USD tập trung vào cơ sở dữ liệu vector và thiết bị trợ lý ảo giao tiếp.",
      },
    ],
    lexemes: [
      { id: 1, grapheme: "AIMind", type: "Phoneme", phoneme: "A-I Mind Technology", state: 1 },
      { id: 2, grapheme: "RAG", type: "Alias", phoneme: "Retrieval-Augmented Generation", state: 1 },
      { id: 3, grapheme: "DUE", type: "Phoneme", phoneme: "D-U-E University of Economics", state: 1 },
      { id: 4, grapheme: "HNSW", type: "Alias", phoneme: "Hierarchical Navigable Small World", state: 1 },
    ],
    chatRecords: [
      {
        id: 101,
        sessionId: "sess_web_78a1bc2",
        source: "WEB",
        question: "Quy định về thời gian thử việc của công ty là bao lâu?",
        answer:
          "Theo mục 3.2 Sổ tay Nhân viên 2026, thời gian thử việc tiêu chuẩn là 02 tháng đối với vị trí chuyên môn kỹ thuật.",
        questionAt: "2026-10-31 20:14:15",
        answerAt: "2026-10-31 20:14:17",
      },
      {
        id: 103,
        sessionId: "sess_web_78a1bc2",
        source: "WEB",
        question: "Thời gian làm việc và nghỉ lễ của công ty quy định thế nào?",
        answer:
          "Giờ làm việc từ 8:00 đến 17:30 từ Thứ Hai đến Thứ Sáu. Các ngày nghỉ lễ theo đúng Bộ luật Lao động hiện hành.",
        questionAt: "2026-10-31 20:16:02",
        answerAt: "2026-10-31 20:16:05",
      },
      {
        id: 102,
        sessionId: "sess_kiosk_99f2e3d",
        source: "KIOSK",
        question: "Bốn trụ cột kinh doanh cốt lõi của AI Mind Technology là gì?",
        answer:
          "AI Mind tập trung vào 4 trụ cột: Enterprise AI Platform, Fintech AI Solutions, Conversational & Voice AI và Computer Vision & Robotics.",
        questionAt: "2026-10-31 21:05:20",
        answerAt: "2026-10-31 21:05:23",
      },
      {
        id: 104,
        sessionId: "sess_web_45b8ca1",
        source: "WEB",
        question: "Cho tôi biết thông tin về hệ thống nhận dạng giọng nói STT?",
        answer:
          "Hệ thống hỗ trợ STT trực tiếp từ microphone qua WebSocket với độ trễ dưới 150ms và chuẩn lấy mẫu 16kHz.",
        questionAt: "2026-11-01 10:22:40",
        answerAt: "2026-11-01 10:22:43",
      },
    ],
    backgrounds: [
      { id: 1, name: "Modern Office Lobby", filename: "office_lobby.jpg", url: "/bg/office_lobby.jpg", active: true },
      { id: 2, name: "Corporate Office", filename: "office.png", url: "/bg/office.png", active: false },
      { id: 3, name: "Entrance", filename: "entrance.png", url: "/bg/entrance.png", active: false },
      { id: 4, name: "Office 1", filename: "office_1.png", url: "/bg/office_1.png", active: false },
      { id: 5, name: "Office 2", filename: "office_2.png", url: "/bg/office_2.png", active: false },
      { id: 6, name: "Office 3", filename: "office_3.png", url: "/bg/office_3.png", active: false },
      { id: 7, name: "Office Blur", filename: "office-blur.png", url: "/bg/office-blur.png", active: false },
    ],
  };
}

export function readDemoStore(): DemoStoreState {
  const defaults = createInitialDemoState();
  try {
    if (fs.existsSync(DEMO_DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DEMO_DATA_FILE, "utf-8")) as Partial<DemoStoreState>;
      return {
        assistants: Array.isArray(parsed.assistants) ? parsed.assistants : defaults.assistants,
        stances: Array.isArray(parsed.stances) ? parsed.stances : defaults.stances,
        files: Array.isArray(parsed.files) ? parsed.files : defaults.files,
        lexemes: Array.isArray(parsed.lexemes) ? parsed.lexemes : defaults.lexemes,
        chatRecords: Array.isArray(parsed.chatRecords) ? parsed.chatRecords : defaults.chatRecords,
        backgrounds: Array.isArray(parsed.backgrounds) ? parsed.backgrounds : defaults.backgrounds,
        clientUsername: typeof parsed.clientUsername === "string" ? parsed.clientUsername : undefined,
        clientPasswordHash:
          typeof parsed.clientPasswordHash === "string" ? parsed.clientPasswordHash : undefined,
        clientPassword: typeof parsed.clientPassword === "string" ? parsed.clientPassword : undefined,
      };
    }
  } catch (err) {
    console.warn("[DemoStore] Failed to read demo-data.json, using defaults:", err);
  }
  return defaults;
}

export function writeDemoStore(
  patch: Partial<DemoStoreState>,
  options?: { throwOnError: boolean },
): DemoStoreState {
  const current = readDemoStore();
  const next: DemoStoreState = {
    ...current,
    ...patch,
  };
  const temporary = `${DEMO_DATA_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf-8");
    fs.renameSync(temporary, DEMO_DATA_FILE);
  } catch (err) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error.
    }
    console.warn("[DemoStore] Failed to write demo-data.json:", err);
    if (options?.throwOnError) throw err;
  }
  return next;
}

export function appendDemoChatRecord(input: {
  sessionId?: string | null;
  source?: string | null;
  question: string;
  answer: string;
  questionAt?: string | null;
  answerAt?: string | null;
}): DemoChatRecord {
  const store = readDemoStore();
  const maxId = store.chatRecords.reduce((m, r) => Math.max(m, r.id), 100);
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
  const rec: DemoChatRecord = {
    id: maxId + 1,
    sessionId: input.sessionId?.trim() || `sess_web_${Date.now().toString(36)}`,
    source: (input.source || "WEB").toUpperCase(),
    question: input.question,
    answer: input.answer,
    questionAt: input.questionAt
      ? input.questionAt.replace("T", " ").slice(0, 19)
      : nowStr,
    answerAt: input.answerAt
      ? input.answerAt.replace("T", " ").slice(0, 19)
      : nowStr,
  };
  writeDemoStore({ chatRecords: [rec, ...store.chatRecords] });
  return rec;
}
