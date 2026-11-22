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
  onerror?: () => void;
  onpause?: () => void;
  onresume?: () => void;
  onboundary?: (event: { charIndex: number; charLength: number; name?: string }) => void;

  constructor(readonly text: string) {}
}

function setupBrowser(voices: { name: string; lang: string }[]) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
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
    const onFailure = vi.fn();
    const playback = speakWithBrowserTts("Xin chào bạn.", {
      lang: "vi", gender: "female", muted: false, signal: new AbortController().signal,
      onFailure,
    });
    await vi.advanceTimersByTimeAsync(1800);
    expect(await playback).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith("voice-missing");
  });

  it("tries another voice in the same language if the first fails before it speaks", async () => {
    const synth = setupBrowser([
      { name: "Default", lang: "en-US" },
      { name: "An", lang: "vi-VN" },
      { name: "HoaiMy", lang: "vi-VN" },
    ]);
    synth.speak.mockImplementationOnce((utterance) => utterance.onerror?.());
    const onFailure = vi.fn();
    const playback = speakWithBrowserTts("Xin chào bạn.", {
      lang: "vi", gender: "female", muted: false, signal: new AbortController().signal,
      onFailure,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.speak.mock.calls.map(([utterance]) => utterance.voice?.name)).toEqual(["HoaiMy", "An"]);
    synth.speaking = false;
    synth.speak.mock.calls[1][0].onend?.();
    expect(await playback).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps moving past a short boundary estimate and stops on pause and end", async () => {
    const synth = setupBrowser([{ name: "HoaiMy", lang: "vi-VN" }]);
    const speaking = vi.fn();
    const openness = vi.fn();
    const playback = speakWithBrowserTts("Xin chào bạn.", {
      lang: "vi", gender: "female", muted: false, signal: new AbortController().signal,
      onSpeakingChange: speaking, onOpenness: openness,
    });
    await vi.advanceTimersByTimeAsync(0);
    const [utterance] = synth.speak.mock.calls[0];
    utterance.onboundary?.({ charIndex: 0, charLength: 3 });
    await vi.advanceTimersByTimeAsync(250);
    expect(openness).toHaveBeenLastCalledWith(null);
    expect(speaking.mock.calls).toEqual([[true]]);

    synth.paused = true;
    utterance.onpause?.();
    await vi.advanceTimersByTimeAsync(600);
    expect(speaking.mock.calls).toEqual([[true], [false]]);
    expect(openness).toHaveBeenLastCalledWith(0);

    synth.paused = false;
    utterance.onresume?.();
    expect(speaking).toHaveBeenLastCalledWith(true);
    synth.speaking = false;
    utterance.onend?.();
    expect(speaking).toHaveBeenLastCalledWith(false);
    expect(openness).toHaveBeenLastCalledWith(0);
    expect(await playback).toBe(true);
  });

  it("rests the mouth at punctuation without ending playback before the voice", async () => {
    const synth = setupBrowser([{ name: "Zira", lang: "en-US" }]);
    const text = "Hello, how are you today?";
    const speaking = vi.fn();
    const openness = vi.fn();
    const playback = speakWithBrowserTts(text, {
      lang: "en", gender: "female", muted: false, signal: new AbortController().signal,
      onSpeakingChange: speaking, onOpenness: openness,
    });
    const completed = vi.fn();
    void playback.then(completed);
    await vi.advanceTimersByTimeAsync(0);
    const [utterance] = synth.speak.mock.calls[0];
    utterance.onboundary?.({ charIndex: 0, charLength: text.length, name: "sentence" });
    utterance.onboundary?.({ charIndex: 0, charLength: 5, name: "word" });
    await vi.advanceTimersByTimeAsync(850);
    expect(speaking.mock.calls).toEqual([[true]]);
    expect(openness).toHaveBeenLastCalledWith(0);

    // A word boundary with no charLength still identifies the final word.
    utterance.onboundary?.({ charIndex: text.indexOf("today"), charLength: 0, name: "word" });
    await vi.advanceTimersByTimeAsync(200);
    expect(openness.mock.lastCall?.[0]).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(speaking.mock.calls).toEqual([[true]]);
    expect(openness).toHaveBeenLastCalledWith(0);

    utterance.onboundary?.({ charIndex: text.length, charLength: 0, name: "sentence" });
    await vi.advanceTimersByTimeAsync(800);
    expect(synth.speaking).toBe(true);
    expect(speaking.mock.calls).toEqual([[true], [false]]);
    expect(completed).not.toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled();

    synth.speaking = false;
    utterance.onend?.();
    expect(await playback).toBe(true);
  });
});

describe("Demo reply language", () => {
  it("keeps the English greeting and introduction free of a Vietnamese role label", () => {
    expect(generateDemoChitchat("hello", "en", "female")).toContain("I'm Chi.");
    const intro = generateDemoChitchat("what is your name?", "en", "male");
    expect(intro).toContain("I am Lee,");
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
