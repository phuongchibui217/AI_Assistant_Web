import { describe, expect, it } from "vitest";

import { detectLangConfident, hasReplyLanguageConflict, voiceFor } from "./lang-detect";

describe("Reply language", () => {
  it("recognizes short English greetings without a microphone hint", () => {
    expect(detectLangConfident("hi!")).toEqual({ lang: "en", confident: true });
  });

  it("uses the English preference for ambiguous Latin text and preserves clear language cues", () => {
    expect(detectLangConfident("Working hours?", "en")).toEqual({ lang: "en", confident: true });
    expect(detectLangConfident("Bạn khỏe không?", "en")).toEqual({ lang: "vi", confident: true });
    expect(detectLangConfident("こんにちは", "en")).toEqual({ lang: "ja", confident: true });
  });

  it("catches a Japanese clause in an English greeting before selecting an English voice", () => {
    const { lang } = detectLangConfident("hi");
    const mixed = "Hello! How can I help you today? お元気ですか？";
    expect(hasReplyLanguageConflict(mixed, lang)).toBe(true);
    expect(hasReplyLanguageConflict("Hello! How can I help you today?", lang)).toBe(false);
    expect(voiceFor(lang, "female").languageCode).toBe("en-US");
  });
});
