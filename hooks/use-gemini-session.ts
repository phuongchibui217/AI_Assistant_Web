"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Avatar } from "@/lib/avatar/avatar";
import { AudioStreamPlayer } from "@/lib/audio-stream-player";
import { logChat } from "@/lib/chat-log";
import {
  detectLang,
  detectSpeechLang,
  localeToSupportedLang,
  sttLangToSupported,
  voiceFor,
  type SupportedLang,
} from "@/lib/lang-detect";
import { formatMarkdownForDisplay, stripMarkdownForTts } from "@/lib/markdown";
import {
  askRagStream,
  askSuggestions,
  classifyKb,
  pumpPcmResponse,
  synthesiseSentenceStream,
} from "@/lib/rag-ask";
import { appendSpoken, batchSentences, splitIntoSentences } from "@/lib/sentence-split";
import { cancelBrowserTts, speakWithBrowserTts } from "@/lib/audio/browser-tts";
import { joinTranscript } from "@/lib/audio/join-transcript";
import {
  isStreamingLang,
  STREAM_STT_CODE,
  type MicLang,
} from "@/lib/audio/mic-input-langs";
import { SttClient } from "@/lib/audio/stt-client";
import { SttStreamer } from "@/lib/audio/stt-streamer";

import { createPlaybackContext, useAudioContext } from "./use-audio-context";
import { useChatMessages, type ChatMessage } from "./use-chat-messages";
import { readStoredGender } from "./use-gender";
import { readTranslateMode } from "./use-translate-mode";

// Error message shown (and spoken) when the RAG backend call fails.
// Keyed by the same SupportedLang codes as VOICE_FOR_LANG.
// Target character length per TTS request. Sentences are coalesced up to this
// size so each request covers several sentences and the voice stays continuous
// (one request per sentence resets prosody at every join - the per-bullet
// "voice jump" on long answers). Tune up for more continuity, down for lower
// per-batch latency.
const TTS_BATCH_TARGET_CHARS = 240;

const RAG_FAIL_MSG: Record<string, string> = {
  ja: "申し訳ございません、ナレッジベースへの問い合わせに失敗しました。",
  en: "Sorry, the knowledge base query failed.",
  ko: "죄송합니다, 지식 베이스 조회에 실패했습니다.",
  zh: "抱歉，知识库查询失败。",
  zhTW: "抱歉，知識庫查詢失敗。",
  ru: "Извините, запрос к базе знаний не удался.",
  vi: "Xin lỗi, truy vấn cơ sở kiến thức thất bại.",
  id: "Maaf, kueri basis pengetahuan gagal.",
  my: "ကြောင်သောကြည်း၊ ကြောသာတ်မှတ် မေးမြန်မော သောမသိပါ။",
  ne: "माफ गर्नुहोस्, ज्ञान आधार प्रश्न असफल भयो।",
  th: "ขออภัย การค้นหาฐานความรู้ล้มเหลว",
  fil: "Paumanhin, nabigo ang pagtatanong sa knowledge base.",
  pt: "Desculpe, a consulta à base de conhecimento falhou.",
};

// Out-of-KB message shown (and spoken) when retrieval returns no relevant
// chunks. Mirrors the FALLBACK table in /api/rag/ask/route.ts but is
// resolved client-side using the STT/UI-detected userLang so the language
// always matches the user's voice — the server uses detectLang(query) which
// may return 'ja' when the user asked about a Japanese topic in their own
// language (e.g. a Korean user typing a Japanese place name).
const OUT_OF_KB_MSG: Record<string, string> = {
  ja: "資料に該当する情報がありません。",
  en: "No relevant information found in the materials.",
  ko: "자료에 관련 정보가 없습니다.",
  zh: "资料中没有相关信息。",
  zhTW: "資料中找不到相關資訊。",
  ru: "В материалах нет соответствующей информации.",
  vi: "Không có thông tin liên quan trong tài liệu.",
  id: "Tidak ada informasi terkait dalam materi.",
  my: "ပစ္စည်းတွင် သက်ဆိုင်ရာ အချက်အလက် မရှိပါ။",
  ne: "सामग्रीमा सम्बन्धित जानकारी छैन।",
  th: "ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร",
  fil: "Walang nahanap na kaugnay na impormasyon sa mga dokumento.",
  pt: "Nenhuma informação relevante encontrada nos materiais.",
};

export type SessionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "disconnected"
  | "error";

export type UseGeminiSession = {
  status: SessionStatus;
  micActive: boolean;
  /** True from the moment the mic stops until the transcript comes back - the
   *  record-then-POST STT has no live interim, so the UI shows a "recognizing"
   *  hint during this gap instead of an empty screen. */
  recognizing: boolean;
  audioMuted: boolean;
  thinking: boolean;
  messages: ChatMessage[];
  errorMessage: string | null;
  /** Text-input draft, controlled by the session so the mic can fill it while
   *  talking (live preview) and typed input can build it up. Bind to the
   *  input's value; write via `setDraft`. */
  draft: string;
  setDraft: (v: string) => void;
  /** Mic input language the user picked (drives STT streaming vs Chirp). */
  micLang: MicLang;
  setMicLang: (l: MicLang) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Push-to-talk: held down opens the mic, release sends the transcript
   *  immediately (client spec 2026-07-30 - no review-before-send step; the
   *  mic button and the "M" hotkey now behave identically). */
  startTalk: () => Promise<void>;
  stopTalk: () => void;
  sendText: (text: string) => Promise<void>;
  /** Edit an already-sent user message: deletes it and its model reply (if
   *  any), then re-asks with the edited text as a fresh question (Messenger-
   *  style edit, client spec 2026-07-30). No-op on an unknown/empty id. */
  editMessage: (id: string, text: string) => Promise<void>;
  toggleAudio: () => void;
  setTtsEnabled: (enabled: boolean) => void;
  skip: () => void;
  /** Push the initial greeting bubble. Returns its id so the caller can
   *  rewrite the text later (e.g. when the avatar gender, hence the name in the
   *  greeting, changes). */
  pushGreeting: (text: string) => string;
  /** Overwrite an existing model bubble's text by id (no-op if unknown). */
  replaceModelText: (id: string, text: string) => void;
  bindAvatar: (avatar: Avatar) => void;
};


/**
 * Resolve the admin-configured mic default into a concrete {@link MicLang}.
 *
 * `"locale"` means "follow the UI language" - the behaviour that existed
 * before this became a setting, kept as the default so no deployment changes
 * behaviour on upgrade.
 *
 * The locale must be translated through `localeToSupportedLang`, NOT indexed
 * into a lang map directly: UI locales are BCP-47 (`zh-TW`) while MicLang uses
 * `SupportedLang` codes (`zhTW`). The old code did `locale in STREAM_STT_CODE`,
 * which quietly returned false for Traditional Chinese and dropped Taiwan to
 * "auto" - losing the live interim transcription that deployment specifically
 * asked for. `ja`/`en` hid the bug because they spell the same in both sets.
 */
function resolveDefaultMicLang(setting: string, locale: string): MicLang {
  if (setting !== "locale") return setting as MicLang;
  const lang = localeToSupportedLang(locale);
  return lang && isStreamingLang(lang) ? lang : "auto";
}

export function useGeminiSession(
  defaultMicLang: string = "locale",
): UseGeminiSession {
  const tErr = useTranslations("errors");
  const locale = useLocale();
  const { ctxRef, ensure: ensureAudio } = useAudioContext();
  const chat = useChatMessages();

  const playerRef = useRef<AudioStreamPlayer | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const analyserAttachedRef = useRef(false);
  const recogniserRef = useRef<SttClient | null>(null);
  const streamerRef = useRef<SttStreamer | null>(null);
  const micWantedRef = useRef(false);
  // Re-entrancy latch for startTalk. The engine refs (streamerRef/recogniserRef)
  // are only assigned AFTER startTalk's `await ensureAudio()/connect()`, so a
  // second press during that window would pass the ref guard and spawn a second
  // engine - two of them writing the draft interleaved (the "sometimes append,
  // sometimes replace" flicker on fast taps). This flips true synchronously at
  // the top of startTalk and clears when setup finishes, so overlapping starts
  // are rejected.
  const micStartingRef = useRef(false);
  const sttFinalBufferRef = useRef<string[]>([]);
  // Chirp's detected spoken language (BCP-47) for the current mic utterance.
  // Captured on the first STT result so the answer + voice follow what was
  // actually spoken, not a script guess of the transcript.
  const sttLangRef = useRef<string>("");
  // The last transcript the mic dropped into the input, with its detected
  // language. Lets `sendText` keep the spoken-language voice hint when the user
  // sends the mic draft unchanged, while an edited draft falls back to script
  // detection (we can't trust the hint once the text differs).
  const micDraftRef = useRef<{ text: string; lang: SupportedLang | null } | null>(
    null,
  );
  // The draft text present when the current mic press began. New speech is
  // appended to it (accumulate-until-send: the input is a cache the user builds
  // up across taps + manual edits, cleared only on send), so pressing the mic
  // again keeps what's there instead of replacing it.
  const micBaseRef = useRef("");
  const ragAbortRef = useRef<AbortController | null>(null);
  // Separate lifetime for the post-answer suggestions request. It must survive
  // a "skip audio" (which aborts ragAbortRef to stop TTS/streaming) - the answer
  // is already rendered, so its follow-up chips are still valid. It is only
  // cancelled when a NEW question starts or the session tears down.
  const suggestAbortRef = useRef<AbortController | null>(null);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [micActive, setMicActive] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  // Text input draft. Lifted into the session so the mic can show a live
  // preview here while talking, and the BottomBar / MobileChat inputs render
  // it controlled.
  const [draft, setDraft] = useState("");
  // Mirror of `draft` so startTalk (a stable callback) can read the current text
  // synchronously to use as the append base without taking `draft` as a dep.
  const draftRef = useRef("");
  draftRef.current = draft;
  // Mic input language the user picked. Drives STT routing: a streaming-capable
  // language uses the `long` model (live interim); "auto" and the rest use the
  // Chirp record-then-POST path (any language, no interim). The starting value
  // comes from the admin setting (see resolveDefaultMicLang).
  const [micLang, setMicLang] = useState<MicLang>(() =>
    resolveDefaultMicLang(defaultMicLang, locale),
  );
  const micLangRef = useRef<MicLang>(micLang);
  micLangRef.current = micLang;
  // Loading/thinking indicator (feedback #45): true from question submit until
  // the answer (or error) bubble appears. Cleared by the effect below whenever
  // a model bubble becomes the latest message, plus explicitly on the
  // no-answer early returns.
  const [thinking, setThinking] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const audioMutedRef = useRef(false);
  // Admin "voice_enabled" gate. When false, TTS is NOT synthesized at all -
  // we never call Cloud/Azure TTS, so no usage cost for audio nobody hears.
  // Distinct from audioMuted (the user's volume button), which keeps playback
  // alive underneath for instant un-mute + avatar lip-sync (feedback item 23).
  // A ref so the streaming closures read the live value without re-deps.
  const ttsEnabledRef = useRef(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clear the thinking indicator as soon as a model bubble (answer or error)
  // becomes the latest message. Covers every path that pushes a reply.
  useEffect(() => {
    const msgs = chat.messages;
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "model") {
      setThinking(false);
    }
  }, [chat.messages]);

  const attachAnalyserIfPossible = useCallback(() => {
    if (analyserAttachedRef.current) return;
    if (!avatarRef.current || !playerRef.current) return;
    avatarRef.current.attachAnalyser(playerRef.current.getAnalyser());
    analyserAttachedRef.current = true;
  }, []);

  const bindAvatar = useCallback(
    (avatar: Avatar) => {
      // Each bind is a fresh Avatar instance with its own LipSyncDriver. Reset
      // the attach guard so the new instance gets the analyser - without this,
      // a re-mount (e.g. the desktop->mobile branch swap once useIsMobile
      // resolves disposes avatar #1 and mounts avatar #2) leaves the live
      // avatar with no analyser and the mouth never lip-syncs.
      avatarRef.current = avatar;
      analyserAttachedRef.current = false;
      attachAnalyserIfPossible();
    },
    [attachAnalyserIfPossible],
  );

  const connect = useCallback(async () => {
    if (playerRef.current) {
      if (status !== "ready") setStatus("ready");
      return;
    }
    setStatus("connecting");
    setErrorMessage(null);

    // Must go through createPlaybackContext, not `new AudioContext()` - a
    // default-rate context here would silently reintroduce the per-buffer
    // resampling that causes the chunk-seam beep on Chrome.
    const ctx = ctxRef.current ?? createPlaybackContext();
    ctxRef.current = ctx;

    const player = new AudioStreamPlayer(ctx);
    player.setVolumeMuted(audioMutedRef.current);
    playerRef.current = player;
    attachAnalyserIfPossible();

    setStatus("ready");
  }, [attachAnalyserIfPossible, ctxRef, status]);

  const teardownSession = useCallback(() => {
    ragAbortRef.current?.abort();
    ragAbortRef.current = null;
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = null;
    micWantedRef.current = false;
    sttFinalBufferRef.current = [];
    sttLangRef.current = "";
    recogniserRef.current?.stop();
    recogniserRef.current = null;
    streamerRef.current?.stop();
    streamerRef.current = null;
    playerRef.current?.clear();
    playerRef.current = null;
    analyserAttachedRef.current = false;
    setMicActive(false);
  }, []);

  const disconnect = useCallback(() => {
    teardownSession();
    setStatus("disconnected");
  }, [teardownSession]);

  const stopTalk = useCallback(() => {
    micWantedRef.current = false;
    // Stop whichever engine is active. Don't null the ref here - each engine's
    // onEnded finalises and clears it. Keep status "listening" through the
    // recognition step so the user still sees the mic working; the engine's
    // finalise flips it to "ready". Only the button state turns off immediately.
    if (streamerRef.current) {
      setRecognizing(true);
      streamerRef.current.stop();
    } else if (recogniserRef.current) {
      setRecognizing(true);
      recogniserRef.current.stop();
    }
    setMicActive(false);
    avatarRef.current?.onTalkEnd();
  }, []);

  const playSpeechChunk = useCallback(
    async (
      response: Promise<Response>,
      text: string,
      lang: SupportedLang,
      gender: "female" | "male",
      signal: AbortSignal,
    ): Promise<void> => {
      if (signal.aborted || !ttsEnabledRef.current) return;
      try {
        const res = await response;
        if (signal.aborted || !ttsEnabledRef.current) return;
        const player = playerRef.current;
        if (!player) throw new Error("Audio player unavailable");
        let receivedAudio = false;
        await pumpPcmResponse(res, signal, (pcm, fade) => {
          if (!ttsEnabledRef.current) return;
          receivedAudio = true;
          player.pushPcm(pcm, fade);
        });
        if (!receivedAudio && !signal.aborted && ttsEnabledRef.current) {
          throw new Error("TTS returned no audio");
        }
        return;
      } catch (err) {
        if (signal.aborted || !ttsEnabledRef.current) return;
        console.warn("[useGeminiSession] TTS failed, using browser voice:", err);
      }
      await playerRef.current?.waitForIdle(signal);
      if (signal.aborted || !ttsEnabledRef.current) return;
      const played = await speakWithBrowserTts(text, {
        lang,
        gender,
        muted: audioMutedRef.current,
        signal,
        onSpeakingChange: (speaking) => avatarRef.current?.setSpeakingOverride(speaking),
        onOpenness: (openness) => avatarRef.current?.setSpeakingOpenness(openness),
      });
      if (!played && !signal.aborted && ttsEnabledRef.current) {
        setErrorMessage(tErr("speechUnavailable"));
      }
    },
    [tErr],
  );

  const speakSentences = useCallback(
    async (text: string, signal: AbortSignal, lang: SupportedLang): Promise<void> => {
      if (signal.aborted || !ttsEnabledRef.current) return;
      const chunks = batchSentences(splitIntoSentences(text), TTS_BATCH_TARGET_CHARS);
      const gender = readStoredGender();
      const voice = voiceFor(lang, gender);
      const pending = chunks.map((chunk) => {
        const response = synthesiseSentenceStream(chunk, signal, { ...voice, gender });
        void response.catch(() => {});
        return response;
      });
      for (let i = 0; i < chunks.length && !signal.aborted; i++) {
        await playSpeechChunk(pending[i], chunks[i], lang, gender, signal);
      }
      await playerRef.current?.waitForIdle(signal);
    },
    [playSpeechChunk],
  );

  const handleUserMessage = useCallback(
    async (text: string, langHint?: SupportedLang | null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await ensureAudio();
      if (!playerRef.current) await connect();

      ragAbortRef.current?.abort();
      const abort = new AbortController();
      ragAbortRef.current = abort;
      // New question invalidates the previous turn's pending suggestions.
      suggestAbortRef.current?.abort();
      const suggestAbort = new AbortController();
      suggestAbortRef.current = suggestAbort;
      playerRef.current?.clear();

      const priorHistory = chat.getRecentHistory(6);
      chat.pushFullUser(trimmed);
      setThinking(true);
      setErrorMessage(null);

      // Detect the user's language for TTS voice selection on both the CHAT and
      // RAG paths. Prefer the Chirp spoken-language hint (mic path) when present:
      // it tells Latin-script languages apart and never defaults an unknown
      // script to Japanese. For typed input (no hint) fall back to script
      // detection - detecting from the ANSWER text can misfire (an answer with
      // katakana product names scores as Japanese even if the user asked in
      // Indonesian/English).
      const userLang = langHint ?? detectLang(trimmed);

      // Interpreter mode (top-bar Translate toggle): bypass classify-kb/RAG/
      // chitchat entirely - this turn is a translation, not a question. Pair
      // is two freely-chosen languages (client spec 2026-08-18: originally
      // locked to ja<->foreign, client asked for either side selectable, e.g.
      // English<->Korean); direction is picked per-turn by which side the
      // input matches, falling back to langA when neither matches (e.g. a
      // third language slipped through detection).
      const translateMode = readTranslateMode();
      if (translateMode.enabled) {
        const targetLang: SupportedLang =
          userLang === translateMode.langA
            ? translateMode.langB
            : translateMode.langA;
        avatarRef.current?.onTalkStart(false);
        const askedAt = new Date().toISOString();
        let translated: string;
        try {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: trimmed, targetLang }),
            signal: abort.signal,
          });
          if (!res.ok) throw new Error(`translate ${res.status}`);
          const json = (await res.json()) as { text?: string };
          translated = (json.text ?? "").trim();
        } catch (err) {
          if (abort.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useGeminiSession] translate failed:", msg);
          setThinking(false);
          avatarRef.current?.onTalkEnd();
          return;
        }
        if (!translated) {
          setThinking(false);
          avatarRef.current?.onTalkEnd();
          return;
        }

        chat.pushFullModel(translated);
        logChat({
          question: trimmed,
          answer: translated,
          questionAt: askedAt,
          answerAt: new Date().toISOString(),
          source: "web",
        });

        try {
          await speakSentences(translated, abort.signal, targetLang);
        } catch (err) {
          if (!abort.signal.aborted) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useGeminiSession] translate TTS failed:", msg);
          }
        }
        if (!abort.signal.aborted) avatarRef.current?.onTalkEnd();
        return;
      }

      const decision = await classifyKb(trimmed, abort.signal, priorHistory).catch(
        () => (abort.signal.aborted ? null : ("KB" as const)),
      );
      if (abort.signal.aborted || decision === null) {
        setThinking(false);
        return;
      }

      avatarRef.current?.onTalkStart(false);

      if (decision === "CHAT") {
        const askedAt = new Date().toISOString();
        let replyText: string;
        try {
          const res = await fetch("/api/chitchat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              query: trimmed,
              history: priorHistory,
              langHint,
              gender: readStoredGender(),
            }),
            signal: abort.signal,
          });
          if (!res.ok) throw new Error(`chitchat ${res.status}`);
          const json = (await res.json()) as { text?: string };
          replyText = (json.text ?? "").trim();
        } catch (err) {
          if (abort.signal.aborted) {
            // Skipped/interrupted: still persist the question to chat history.
            logChat({
              question: trimmed,
              answer: "",
              questionAt: askedAt,
              answerAt: new Date().toISOString(),
              source: "web",
            });
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useGeminiSession] chitchat failed:", msg);
          setThinking(false);
          avatarRef.current?.onTalkEnd();
          return;
        }
        if (!replyText) {
          setThinking(false);
          avatarRef.current?.onTalkEnd();
          return;
        }

        chat.pushFullModel(replyText);
        logChat({
          question: trimmed,
          answer: replyText,
          questionAt: askedAt,
          answerAt: new Date().toISOString(),
          source: "web",
        });

        try {
          await speakSentences(replyText, abort.signal, detectSpeechLang(replyText, langHint));
        } catch (err) {
          if (!abort.signal.aborted) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useGeminiSession] chitchat TTS failed:", msg);
          }
        }
        if (!abort.signal.aborted) avatarRef.current?.onTalkEnd();
        return;
      }

      const askedAt = new Date().toISOString();

      // Streaming RAG: fill the bubble token-by-token and start speaking each
      // sentence as soon as it completes, instead of waiting for the whole
      // answer. The server already streams SSE deltas (askRagStream); this
      // wires them into the chat bubble (appendModelChunk) and an ordered TTS
      // playback chain, so perceived latency drops from "full answer" (~10s on
      // long replies) to "first sentence" (~1-2s).
      // Keep the reply voice consistent across cloud and browser playback.
      const ttsGender = readStoredGender();
      let speechLang: SupportedLang | null = null;
      const streamedSpeech = new AbortController();
      abort.signal.addEventListener("abort", () => streamedSpeech.abort(), { once: true });
      let rawAnswer = "";
      let gotDelta = false;
      let outOfKbEarly = false;
      let spokenCount = 0;
      // Synthesis fires in parallel as sentences complete; playback is
      // serialised through this chain so audio stays in the right order.
      let playChain: Promise<void> = Promise.resolve();
      const enqueuePlay = (chunk: string, lang: SupportedLang) => {
        const voice = voiceFor(lang, ttsGender);
        const response = synthesiseSentenceStream(chunk, streamedSpeech.signal, { ...voice, gender: ttsGender });
        void response.catch(() => {});
        playChain = playChain.then(() =>
          playSpeechChunk(response, chunk, lang, ttsGender, streamedSpeech.signal),
        );
      };
      // Speak every fully-formed sentence. While streaming, hold back the last
      // (possibly partial) sentence until more text arrives or the stream ends
      // (`final`). Skipped for out-of-KB answers, whose text is re-localised at
      // the end and spoken in one shot to avoid speaking the wrong language.
      const flushTts = (final: boolean) => {
        if (streamedSpeech.signal.aborted || !ttsEnabledRef.current) return;
        if (outOfKbEarly) return;
        const tts = stripMarkdownForTts(rawAnswer);
        const sentences = splitIntoSentences(tts);
        // Only sentences known to be complete are eligible; while streaming the
        // trailing one may still be growing until `final`.
        const available = final ? sentences.length : sentences.length - 1;
        if (spokenCount >= available) return;
        speechLang ??= detectSpeechLang(tts, langHint);
        // Coalesce sentences into ~TTS_BATCH_TARGET_CHARS batches so each TTS
        // request spans several sentences and prosody stays continuous - one
        // request per sentence resets the voice baseline at every join, heard
        // as a "jump" at the start of each bullet on long answers. Exception:
        // the very first batch is a single sentence so audio still starts
        // ~1-2 s in. Mid-stream a sub-target tail waits for more text; on
        // `final` whatever remains is flushed regardless of size.
        while (spokenCount < available) {
          let end = spokenCount;
          if (spokenCount === 0) {
            end = spokenCount + 1; // fast first utterance
          } else {
            let len = 0;
            while (end < available && len < TTS_BATCH_TARGET_CHARS) {
              len += sentences[end].length;
              end++;
            }
            if (!final && len < TTS_BATCH_TARGET_CHARS) break; // wait for a full batch
          }
          // appendSpoken (not join(" ")) so punctuation-less bullet lines get a
          // pause instead of running together within this one TTS request.
          const chunk = sentences.slice(spokenCount, end).reduce(appendSpoken, "").trim();
          spokenCount = end;
          if (chunk) enqueuePlay(chunk, speechLang);
        }
      };

      let result: Awaited<ReturnType<typeof askRagStream>>;
      try {
        result = await askRagStream(
          trimmed,
          {
            onMeta: (m) => {
              outOfKbEarly = m.outOfKb;
              speechLang = m.answerLang ?? null;
            },
            onDelta: (delta) => {
              gotDelta = true;
              rawAnswer += delta;
              chat.appendModelChunk(delta);
              flushTts(false);
            },
          },
          abort.signal,
          priorHistory,
          langHint,
        );
      } catch (err) {
        if (abort.signal.aborted) {
          // Skipped/interrupted mid-stream: persist the question + whatever
          // partial answer streamed so the turn is not lost from chat history.
          logChat({
            question: trimmed,
            answer: rawAnswer,
            questionAt: askedAt,
            answerAt: new Date().toISOString(),
            source: "web",
          });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useGeminiSession] RAG ask failed:", msg);
        // Show and speak the error in the user's own language. If a partial
        // answer already streamed in, replace it so we never leave a truncated
        // reply on screen as if it were complete.
        const errorMsg = RAG_FAIL_MSG[userLang] ?? RAG_FAIL_MSG.ja;
        const partialId = gotDelta ? chat.currentModelMessageId() : null;
        if (partialId) {
          chat.replaceModelText(partialId, errorMsg);
          chat.endTurn();
        } else {
          chat.pushFullModel(errorMsg);
        }
        logChat({
          question: trimmed,
          answer: errorMsg,
          questionAt: askedAt,
          answerAt: new Date().toISOString(),
          source: "web",
        });
        try {
          streamedSpeech.abort();
          playerRef.current?.clear();
          await speakSentences(errorMsg, abort.signal, userLang);
        } catch {
          // TTS failure for the error message itself is non-fatal.
        }
        if (!abort.signal.aborted) avatarRef.current?.onTalkEnd();
        return;
      }
      if (abort.signal.aborted) {
        // Skipped/interrupted after the stream returned but before finalising:
        // persist the question + partial answer so it stays in chat history.
        logChat({
          question: trimmed,
          answer: rawAnswer,
          questionAt: askedAt,
          answerAt: new Date().toISOString(),
          source: "web",
        });
        return;
      }

      // When the KB has no matching content, override the server's answer
      // with the localised message for userLang. The server picks the
      // language from detectLang(query), which may return 'ja' when the
      // user asked about a Japanese topic in their native language — causing
      // a Korean/Vietnamese/etc voice to speak Japanese text.
      //
      // Safety-net: Flash may still output a Japanese "no-info" phrase even when
      // 【資料なし応答文】 is injected with the correct language. Detect and
      // replace client-side. Covers BOTH phrasings the RAG prompt instructs:
      // "資料に該当する情報がありません" (confident path, OUT_OF_KB_MSGS verbatim)
      // and "該当する情報が見つかりませんでした" (low-confidence path, buildGroundedPrompt
      // 【資料なし応答文】). Missing the second variant left citation chips under a
      // no-info answer and showed the JP phrase for a non-JP question.
      const NO_INFO_JA_RE =
        /^(?:資料[にには]*)?(?:該当|関連)する情報が(?:ありません|見つかりません(?:でした)?)[。]?$/;
      // Safety-net: if the model echoed an injected internal directive label
      // instead of just the answer text - either the whole 【資料なし応答文...】
      // line, or a 【ケースA/ケースB...】 case-branching heading copied verbatim
      // from RAG_SYSTEM_PROMPT's no-info branching rule (seen in eval, KB-
      // independent) - strip the leading 【...】 label so the real content
      // shows and the no-info detection below (anchored with ^) still
      // matches. Anchored to line start only, so it never touches a bracketed
      // term that's part of the actual answer body. The prompt was reworked
      // to prevent both leaks, but a leak must never surface to the user.
      const cleaned = result.answer.replace(/^\s*【(?:資料なし応答文|ケース[^】]*)[^】]*】\s*/, "");
      const answerRaw =
        result.outOfKb ||
        (userLang !== "ja" && NO_INFO_JA_RE.test(cleaned.trim()))
          ? (OUT_OF_KB_MSG[userLang] ?? OUT_OF_KB_MSG.ja)
          : cleaned;

      // Suppress citation chips when the final answer is a "no info" message.
      // Retrieval can return chunks above min_score (so the server attaches
      // citations) while Flash still judges them irrelevant and outputs the
      // no-info phrase — leaving reference chips under a "no information"
      // answer. That contradiction is exactly what the client flagged (#29:
      // "資料は表示されているのに該当情報なし"). If there is no usable answer,
      // there is nothing to cite.
      const answerIsNoInfo =
        result.outOfKb ||
        NO_INFO_JA_RE.test(cleaned.trim()) ||
        answerRaw.trim() === (OUT_OF_KB_MSG[userLang] ?? OUT_OF_KB_MSG.ja);
      const citations = answerIsNoInfo ? [] : result.citations;

      const displayText = formatMarkdownForDisplay(answerRaw);
      const ttsText = stripMarkdownForTts(answerRaw);

      // Finalise the streamed bubble: swap the raw markdown for the formatted
      // display text and attach citations. If nothing streamed (empty answer,
      // or an out-of-KB reply that produced no usable bubble), push a fresh
      // bubble instead.
      let answerMsgId = gotDelta ? chat.currentModelMessageId() : null;
      if (answerMsgId) {
        chat.replaceModelText(answerMsgId, displayText);
        chat.setCurrentModelCitations(citations);
      } else {
        answerMsgId = chat.pushFullModel(displayText, citations);
      }
      chat.endTurn();

      logChat({
        question: trimmed,
        answer: answerRaw,
        questionAt: askedAt,
        answerAt: new Date().toISOString(),
        source: "web",
      });

      // Uses suggestAbort (not the turn's `abort`) so pressing "skip audio"
      // mid-answer does not throw away the already-rendered answer's follow-up
      // chips - only a new question or teardown cancels them.
      void askSuggestions(trimmed, ttsText, suggestAbort.signal, chat.getRecentHistory(6), userLang)
        .then((s) => {
          if (suggestAbort.signal.aborted || s.length === 0) return;
          if (answerMsgId) chat.setSuggestionsForMessage(answerMsgId, s);
        })
        .catch(() => undefined);

      try {
        if (outOfKbEarly || ttsText !== stripMarkdownForTts(rawAnswer)) {
          // Out-of-KB or re-localised: nothing (or the wrong language) was
          // streamed to TTS, so drop any queued audio and speak the corrected
          // text in one shot.
          streamedSpeech.abort();
          playerRef.current?.clear();
          const lang = answerIsNoInfo ? userLang : (speechLang ?? detectSpeechLang(ttsText, langHint));
          await speakSentences(ttsText, abort.signal, lang);
        } else {
          flushTts(true);
          await playChain;
          await playerRef.current?.waitForIdle(abort.signal);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useGeminiSession] TTS failed:", msg);
        }
      }
      if (!abort.signal.aborted) avatarRef.current?.onTalkEnd();
    },
    [chat, connect, ensureAudio, playSpeechChunk, speakSentences],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (recogniserRef.current) stopTalk();
      // Carry the mic's spoken-language hint only when the user sends the mic
      // draft verbatim; any edit makes the hint untrustworthy so we fall back to
      // script detection inside handleUserMessage.
      const md = micDraftRef.current;
      const hint = md && md.text === trimmed ? md.lang : null;
      micDraftRef.current = null;
      setDraft("");
      await handleUserMessage(trimmed, hint);
    },
    [handleUserMessage, stopTalk],
  );

  // Declared before `startTalk` (which calls it for barge-in) so the latter's
  // dependency array doesn't reference a binding before its declaration.
  const skip = useCallback(() => {
    ragAbortRef.current?.abort();
    ragAbortRef.current = null;
    cancelBrowserTts();
    playerRef.current?.clear();
    avatarRef.current?.setSpeakingOverride(false);
    avatarRef.current?.onTalkEnd();
    setThinking(false);
  }, []);

  const startTalk = useCallback(async () => {
    // Reject overlapping starts: the ref guard alone is not enough because the
    // engine refs are set only after the awaits below (see micStartingRef).
    if (recogniserRef.current || streamerRef.current || micStartingRef.current)
      return;
    micStartingRef.current = true;
    setErrorMessage(null);

    // Barge-in (client spec 2026-08-11): pressing the mic while the avatar is
    // still speaking interrupts it immediately, same as the Skip button -
    // otherwise the previous answer kept talking underneath the new question
    // until it was sent. Harmless no-op when nothing is playing (aborting an
    // already-settled controller / clearing an empty player does nothing).
    skip();

    // Accumulate-until-send: pin the current draft (typed + previously spoken)
    // as the base and append this utterance onto it, rather than clearing. The
    // input is a cache the user builds up across taps and manual edits; it is
    // cleared only when the message is sent (see sendText). Captured before the
    // awaits so it reflects exactly what was on screen when the mic was pressed.
    micBaseRef.current = draftRef.current;

    try {
    await ensureAudio();
    if (!playerRef.current) await connect();

    // No language is passed: the server runs Chirp with automatic language
    // detection, so the mic transcribes whatever the user actually speaks
    // regardless of the UI language.
    micWantedRef.current = true;
    sttFinalBufferRef.current = [];
    sttLangRef.current = "";

    // Route by the picked mic language: streaming-capable languages use the
    // `long` model for live interim; "auto" and the rest fall through to the
    // sync Chirp path below (any language, no interim).
    const pickedLang = micLangRef.current;
    if (isStreamingLang(pickedLang)) {
      const streamer = new SttStreamer({
        onPartial: (text) => {
          // Append this utterance to the pre-press base (accumulate-until-send).
          setDraft(joinTranscript(micBaseRef.current, text));
        },
        onFinal: (text, lang) => {
          const piece = text.trim();
          if (!piece) return;
          const combined = joinTranscript(micBaseRef.current, piece);
          // Keep the spoken-language hint with the draft (same policy as the
          // sync path) so an unedited send follows the spoken language.
          const mapped = lang ? sttLangToSupported(lang) : null;
          // Fall back to the picked language (not a hardcoded guess) when the
          // server did not name one - the user told us what they are speaking.
          const hint: SupportedLang | null = mapped ?? pickedLang;
          micDraftRef.current = { text: combined, lang: hint };
          setDraft(combined);
          // Auto-send on release, no review step (client spec 2026-07-30).
          void sendText(combined);
        },
        onAutoStop: () => {
          setMicActive(false);
          setRecognizing(true);
          avatarRef.current?.onTalkEnd();
        },
        onError: (msg, kind) => {
          console.warn("[useGeminiSession] STT stream error:", msg);
          // Only a real getUserMedia rejection is a browser mic-permission
          // problem. Backend failures carry their own text (Google says
          // PERMISSION_DENIED when the Speech-to-Text API is disabled) and must
          // NOT be relabelled as "check your browser settings".
          setErrorMessage(kind === "mic" ? tErr("micPermissionDenied") : `stt: ${msg}`);
          micWantedRef.current = false;
        },
        onEnded: () => {
          streamerRef.current = null;
          micWantedRef.current = false;
          setMicActive(false);
          setRecognizing(false);
          setStatus("ready");
          avatarRef.current?.onTalkEnd();
        },
      }, STREAM_STT_CODE[pickedLang]);

      streamerRef.current = streamer;
      try {
        await streamer.start();
      } catch {
        streamerRef.current = null;
        micWantedRef.current = false;
        setMicActive(false);
        setRecognizing(false);
        setStatus("ready");
        avatarRef.current?.onTalkEnd();
        return;
      }
      // Released before setup finished (a quick tap): stop now instead of
      // latching the mic on. stopTalk() ran before the ref existed, so nothing
      // would have stopped it.
      if (!micWantedRef.current) {
        streamer.stop();
        return;
      }
      setMicActive(true);
      setStatus("listening");
      avatarRef.current?.onTalkStart(true);
      return;
    }

    const finalise = () => {
      const combined = sttFinalBufferRef.current.join(" ").trim();
      const spokenLang = sttLangRef.current;
      sttFinalBufferRef.current = [];
      sttLangRef.current = "";
      recogniserRef.current = null;
      micWantedRef.current = false;
      setMicActive(false);
      setRecognizing(false);
      setStatus("ready");
      avatarRef.current?.onTalkEnd();
      // Auto-send on release, no review step (client spec 2026-07-30). Keep
      // Chirp's detected language (mapped to a supported voice) alongside the
      // draft so the answer + voice follow the spoken language instead of a
      // script guess. When Chirp DID detect a language we don't support (e.g.
      // spoken French), force the Japanese fallback - the honest
      // "unsupported -> Japanese" policy the mic can make because Chirp names
      // the real language. Empty (user said nothing / clicked through) just
      // resets to ready.
      if (combined) {
        const full = joinTranscript(micBaseRef.current, combined);
        const mapped = spokenLang ? sttLangToSupported(spokenLang) : null;
        const hint: SupportedLang | null =
          mapped ?? (spokenLang ? "ja" : null);
        micDraftRef.current = { text: full, lang: hint };
        setDraft(full);
        void sendText(full);
      }
    };

    const client = new SttClient({
      onFinal: (text, lang) => {
        const piece = text.trim();
        if (piece) sttFinalBufferRef.current.push(piece);
        // First non-empty detected language wins for the utterance.
        if (lang && !sttLangRef.current) sttLangRef.current = lang;
      },
      onAutoStop: () => {
        // VAD detected the user went silent. Flip the mic button off now and
        // show the "recognizing" hint; status stays "listening" until
        // finalise() runs after recognition.
        setMicActive(false);
        setRecognizing(true);
        avatarRef.current?.onTalkEnd();
      },
      onError: (msg, kind) => {
        console.warn("[useGeminiSession] STT error:", msg);
        setErrorMessage(kind === "mic" ? tErr("micPermissionDenied") : `stt: ${msg}`);
        micWantedRef.current = false;
      },
      onEnded: () => {
        finalise();
      },
    });

    recogniserRef.current = client;
    try {
      await client.start();
    } catch {
      recogniserRef.current = null;
      micWantedRef.current = false;
      setMicActive(false);
      setRecognizing(false);
      setStatus("ready");
      avatarRef.current?.onTalkEnd();
      return;
    }

    // Same quick-tap guard as the streaming path above.
    if (!micWantedRef.current) {
      client.stop();
      return;
    }

    setMicActive(true);
    setStatus("listening");
    avatarRef.current?.onTalkStart(true);
    } finally {
      // Setup done (success, early return, or throw). Release the latch so the
      // next press can start; from here the engine refs guard re-entrancy.
      micStartingRef.current = false;
    }
  }, [
    connect,
    ensureAudio,
    sendText,
    skip,
    tErr,
  ]);

  const toggleAudio = useCallback(() => {
    void ensureAudio();
    setAudioMuted((prev) => {
      const next = !prev;
      audioMutedRef.current = next;
      playerRef.current?.setVolumeMuted(next);
      return next;
    });
  }, [ensureAudio]);

  // Admin voice gate (idempotent). When disabled, TTS is skipped at the source
  // (no synthesis cost) and any in-flight audio is dropped so it stops now.
  const setTtsEnabled = useCallback((enabled: boolean) => {
    ttsEnabledRef.current = enabled;
    if (!enabled) {
      playerRef.current?.clear();
      cancelBrowserTts();
    }
  }, []);

  const pushGreeting = useCallback((text: string): string => {
    return chat.pushFullModel(text);
  }, []);

  const replaceModelText = useCallback((id: string, text: string) => {
    chat.replaceModelText(id, text);
  }, []);

  // Messenger-style edit: delete the sent message + its reply, re-ask with the
  // edited text (client spec 2026-07-30 - editing now happens on already-sent
  // history, not before send, since the mic no longer has a review step).
  const editMessage = useCallback(
    async (id: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const idx = chat.messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const next = chat.messages[idx + 1];
      chat.removeMessage(id);
      if (next && next.role === "model") chat.removeMessage(next.id);
      await handleUserMessage(trimmed, null);
    },
    [chat, handleUserMessage],
  );

  useEffect(() => {
    return () => teardownSession();
  }, [teardownSession]);

  return {
    status,
    micActive,
    recognizing,
    audioMuted,
    thinking,
    messages: chat.messages,
    errorMessage,
    draft,
    setDraft,
    micLang,
    setMicLang,
    connect,
    disconnect,
    startTalk,
    stopTalk,
    sendText,
    editMessage,
    toggleAudio,
    setTtsEnabled,
    skip,
    pushGreeting,
    replaceModelText,
    bindAvatar,
  };
}
