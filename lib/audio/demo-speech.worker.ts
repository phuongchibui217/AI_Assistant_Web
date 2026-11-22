/// <reference lib="webworker" />

import manifest from "@spelling-creator/spellophone/espeak-ng-data/manifest.json";

import { floatToPcm16 } from "../audio-convert";
import { LinearResampler } from "../audio-resample";
import { PLAYBACK_RATE } from "../audio-stream-player";
import type { DemoSpeechRequest, DemoSpeechResult } from "./demo-speech";

const scope = self as unknown as DedicatedWorkerGlobalScope & {
  Spellophone: typeof import("@spelling-creator/spellophone/legacy");
};
const engineUrl = new URL("@spelling-creator/spellophone/legacy/spellophone.iife.js", import.meta.url);
const dictionaries = new Map<string, URL>([
  ["core.bin.gz", new URL("@spelling-creator/spellophone/espeak-ng-data/core.bin.gz", import.meta.url)],
  ["en_dict.gz", new URL("@spelling-creator/spellophone/espeak-ng-data/en_dict.gz", import.meta.url)],
  ["vi_dict.gz", new URL("@spelling-creator/spellophone/espeak-ng-data/vi_dict.gz", import.meta.url)],
  ["ja_dict.gz", new URL("@spelling-creator/spellophone/espeak-ng-data/ja_dict.gz", import.meta.url)],
  ["cmn_dict.gz", new URL("@spelling-creator/spellophone/espeak-ng-data/cmn_dict.gz", import.meta.url)],
]);

// Resolve only the dictionaries bundled with the demo. Synthesis stays local.
const fetchData: typeof fetch = async (input) => {
  const pathname = new URL(input instanceof Request ? input.url : input).pathname;
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (name === "manifest.json") return Response.json(manifest);
  const url = dictionaries.get(name);
  return url ? fetch(url) : new Response(null, { status: 404 });
};

scope.onmessage = async ({ data }: MessageEvent<DemoSpeechRequest>) => {
  try {
    scope.importScripts(engineUrl.href);
    const { createEspeak, toFloat32 } = scope.Spellophone;
    const engine = await createEspeak({ dataUrl: "/", fetch: fetchData });
    try {
      await engine.loadVoice(data.voice);
      let text = data.text;
      let audio: { samples: Float32Array; sampleRate: number } | undefined;
      if (data.voice === "vi") {
        try {
          const { normalizeVietnameseSpeech, synthesizeVietnameseSpeech } = await import("./vietnamese-speech");
          text = normalizeVietnameseSpeech(text);
          audio = await synthesizeVietnameseSpeech(text, data.gender, (phrase) => engine.phonemes(phrase, { ipa: true }));
        } catch (error) {
          console.warn("Vietnamese voice model unavailable:", error);
        }
      }
      if (!audio) {
        const { samples, sampleRate } = engine.synthesize(text, {
          rate: data.voice === "vi" ? 168 : 155,
          pitch: data.gender === "male" ? 42 : 55,
        });
        audio = { samples: toFloat32(samples), sampleRate };
      }
      const resampled = new LinearResampler(audio.sampleRate, PLAYBACK_RATE).process(audio.samples);
      const pcm = floatToPcm16(resampled);
      scope.postMessage({ pcm } satisfies DemoSpeechResult, [pcm.buffer]);
    } finally {
      engine.dispose();
    }
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies DemoSpeechResult);
  }
};
