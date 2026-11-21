import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSpeechLang } from "../lang-detect";
import { generateDemoChitchat } from "../server/demo-chat";
import { splitIntoSentences } from "../sentence-split";
import { speakWithBrowserTts } from "./browser-tts";

class TestUtterance {
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart?: () => void;
  onend?: () => void;

  constructor(readonly text: string) {}
}

function setupBrowser(voices: { name: string; lang: string }[]) {
  vi.useFakeTimers();
  const synth = Object.assign(new EventTarget(), {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => voices,
    speak: vi.fn((utterance: TestUtterance) => {
      synth.speaking = true;
      utterance.onstart?.();
    }),
    cancel: vi.fn(() => { synth.speaking = false; }),
  });
  vi.stubGlobal("SpeechSynthesisUtterance", TestUtterance);
  vi.stubGlobal("window", {
    speechSynthesis: synth,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  return synth;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Browser speech playback", () => {
  it("lets an active utterance finish before starting the next part", async () => {
    const synth = setupBrowser([{ name: "HoaiMy", lang: "vi-VN" }]);
    const text = "Đây là một câu trả lời tiếng Việt để kiểm tra âm thanh. ".repeat(10).trim();
    const speaking = vi.fn();
    const playback = speakWithBrowserTts(text, {
      lang: "vi",
      gender: "female",
      muted: false,
      signal: new AbortController().signal,
      onSpeakingChange: speaking,
    });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(speaking).not.toHaveBeenCalledWith(false);
    expect(synth.cancel).not.toHaveBeenCalled();

    for (let i = 0; i < synth.speak.mock.calls.length; i++) {
      const [utterance] = synth.speak.mock.calls[i];
      expect(utterance.voice?.lang).toBe("vi-VN");
      synth.speaking = false;
      utterance.onend?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(synth.speak.mock.calls.length).toBeGreaterThan(1);
    expect(synth.speak.mock.calls.map(([utterance]) => utterance.text).join(" ")).toBe(text);
    expect(await playback).toBe(true);
    expect(speaking).toHaveBeenLastCalledWith(false);
  });

  it("waits for the Vietnamese voice list instead of choosing the default English voice", async () => {
    const voices = [{ name: "Default", lang: "en-US" }];
    const synth = setupBrowser(voices);
    const abort = new AbortController();
    const playback = speakWithBrowserTts("Xin chào bạn.", {
      lang: "vi", gender: "female", muted: false, signal: abort.signal,
    });
    expect(synth.speak).not.toHaveBeenCalled();
    voices.push({ name: "HoaiMy", lang: "vi-VN" });
    synth.dispatchEvent(new Event("voiceschanged"));
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.speak.mock.calls[0][0].voice?.lang).toBe("vi-VN");
    abort.abort();
    expect(await playback).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable speech when the browser has no matching voice", async () => {
    const synth = setupBrowser([{ name: "Default", lang: "en-US" }]);
    const playback = speakWithBrowserTts("Xin chào bạn.", {
      lang: "vi", gender: "female", muted: false, signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await playback).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe("Demo reply language", () => {
  it("keeps the English greeting and introduction free of a Vietnamese role label", () => {
    expect(generateDemoChitchat("hello", "en", "female")).toContain("I'm Chi.");
    const intro = generateDemoChitchat("what is your name?", "en", "male");
    expect(intro).toContain("I am Minh,");
    expect(intro).not.toContain("Trợ lý ảo");
    expect(detectSpeechLang(intro)).toBe("en");
  });

  it("uses Vietnamese for Vietnamese reply text even with an English input hint", () => {
    expect(detectSpeechLang("Xin chào! Mình là Chi.", "en")).toBe("vi");
    expect(detectSpeechLang("Cho tôi biết thông tin.".normalize("NFD"), "en")).toBe("vi");
    expect(detectSpeechLang("xin chao")).toBe("vi");
  });

  it("keeps product names and decimals within the spoken sentence", () => {
    expect(splitIntoSentences("Hệ thống dùng Next.js phiên bản 14.2. Cảm ơn bạn.")).toEqual([
      "Hệ thống dùng Next.js phiên bản 14.2.",
      "Cảm ơn bạn.",
    ]);
  });
});
