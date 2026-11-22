import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareLocalTranslation } from "./translate-local";

afterEach(() => vi.unstubAllGlobals());

describe("Demo interpreter", () => {
  it("translates sample phrases without a browser translator in either direction", async () => {
    vi.stubGlobal("Translator", undefined);
    const { signal } = new AbortController();
    await expect(prepareLocalTranslation("Xin chào.", "vi", "en")(signal)).resolves.toBe("Hello!");
    await expect(prepareLocalTranslation("HELLO!", "en", "vi")(signal)).resolves.toBe("Xin chào!");
    await expect(prepareLocalTranslation("こんにちは。", "ja", "zh")(signal)).resolves.toBe("你好！");
    await expect(prepareLocalTranslation("你好！", "zh", "ja")(signal)).resolves.toBe("こんにちは！");
  });

  it("uses the browser for other sentences and preserves the selected direction", async () => {
    const translate = vi.fn().mockResolvedValue("  我下午出發。  ");
    const create = vi.fn().mockResolvedValue({ translate });
    vi.stubGlobal("Translator", { create });
    const { signal } = new AbortController();
    const text = "I leave this afternoon.";

    const run = prepareLocalTranslation(text, "en", "zhTW");
    expect(create).toHaveBeenCalledWith({ sourceLanguage: "en", targetLanguage: "zh-Hant" });
    await expect(run(signal)).resolves.toBe("我下午出發。");
    expect(translate).toHaveBeenCalledWith(text, { signal });
  });

  it("reports an unavailable translation instead of returning the input", async () => {
    vi.stubGlobal("Translator", { create: vi.fn().mockRejectedValue(new Error("Unavailable")) });
    const { signal } = new AbortController();
    await expect(prepareLocalTranslation("I leave this afternoon.", "en", "vi")(signal)).resolves.toBeNull();
  });
});
