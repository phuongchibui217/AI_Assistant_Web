import { afterEach, describe, expect, it, vi } from "vitest";

import { detectLang, voiceFor } from "../lang-detect";
import { classifyQueryLocal, searchDemoKnowledgeBase } from "./demo-chat";
import { createInitialDemoState, readDemoStore } from "./demo-store";

vi.mock("./demo-store", async (importOriginal) => {
  const store = await importOriginal<typeof import("./demo-store")>();
  return { ...store, readDemoStore: vi.fn(store.createInitialDemoState) };
});

afterEach(() => {
  vi.mocked(readDemoStore).mockImplementation(createInitialDemoState);
});

describe("Demo knowledge base answer language", () => {
  it.each([
    ["What technologies power the system architecture?", "Product_Architecture_Guide.docx", "Celery workers handle background tasks"],
    ["What is the probation period and working hours?", "Employee_Handbook_2026.pdf", "two-month probation period"],
    ["What was the Q3 2026 financial revenue growth?", "Financial_Report_Q3_2026.xlsx", "revenue grew 38 percent"],
    ["What services does AI Mind offer?", "Customer_FAQ_Policy.html", "fintech AI solutions"],
  ])("answers in English for %s", (question, filename, detail) => {
    const result = searchDemoKnowledgeBase(question, detectLang(question));
    expect(result.answer).toContain(detail);
    expect(detectLang(result.answer)).toBe("en");
    expect(result.answerLang).toBe("en");
    expect(voiceFor(result.answerLang, "female").languageCode).toBe("en-US");
    expect(result.citations[0].filename).toBe(filename);
    expect(result.outOfKb).toBe(false);
  });

  it("returns Vietnamese text and a Vietnamese voice for Vietnamese queries", () => {
    const result = searchDemoKnowledgeBase("Kiến trúc hệ thống dùng những công nghệ gì?", "vi");
    expect(result.answer).toContain("Kiến trúc hệ thống");
    expect(voiceFor(result.answerLang, "female").languageCode).toBe("vi-VN");
  });

  it.each([
    ["ja", "リアルタイム"],
    ["zhTW", "嘴型同步"],
  ] as const)("answers in selected %s for an English question", (lang, expected) => {
    const result = searchDemoKnowledgeBase("What technologies power the system architecture?", lang);
    expect(result.answer).toContain(expected);
    expect(result.answerLang).toBe(lang);
    expect(result.citations[0].filename).toBe("Product_Architecture_Guide.docx");
  });

  it("recognizes greetings written in scripts without spaces", () => {
    expect(classifyQueryLocal("ありがとうございます")).toBe("CHAT");
    expect(classifyQueryLocal("你好！")).toBe("CHAT");
  });

  it("keeps the source link when an edited document has no English version", () => {
    const store = createInitialDemoState();
    store.files[1].rawContent = "Kiến trúc mới sử dụng các tác vụ nền đã cập nhật.";
    vi.mocked(readDemoStore).mockReturnValue(store);

    const result = searchDemoKnowledgeBase("What technologies power the system architecture?", "en");
    expect(result.answer).toContain("English version of this document is unavailable");
    expect(result.answer).not.toContain("Celery");
    expect(result.answerLang).toBe("en");
    expect(result.citations[0].filename).toBe("Product_Architecture_Guide.docx");
  });
});
