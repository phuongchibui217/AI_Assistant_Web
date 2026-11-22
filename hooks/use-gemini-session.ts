"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Avatar } from "@/lib/avatar/avatar";
import { AudioStreamPlayer } from "@/lib/audio-stream-player";
import { logChat } from "@/lib/chat-log";
import type { Citation } from "@/lib/citations";
import {
  detectLang,
  localeToSupportedLang,
  sttLangToSupported,
  voiceFor,
  type SupportedLang,
} from "@/lib/lang-detect";
import { formatMarkdownForDisplay, stripMarkdownForTts } from "@/lib/markdown";
import { pumpPcmResponse, synthesiseSentenceStream } from "@/lib/rag-ask";
import { batchSentences, splitIntoSentences } from "@/lib/sentence-split";
import { prepareBrowserTranslator, prepareLocalTranslation } from "@/lib/translate-local";
import { cancelBrowserTts, speakWithBrowserTts } from "@/lib/audio/browser-tts";
import { synthesizeDemoSpeech } from "@/lib/audio/demo-speech";
import { joinTranscript } from "@/lib/audio/join-transcript";
import {
  isStreamingLang,
  resolveDefaultMicLang,
  STREAM_STT_CODE,
  type MicLang,
} from "@/lib/audio/mic-input-langs";
import { SttClient } from "@/lib/audio/stt-client";
import { SttStreamer } from "@/lib/audio/stt-streamer";

import { createPlaybackContext, useAudioContext } from "./use-audio-context";
import { useChatMessages, type ChatMessage } from "./use-chat-messages";
import { readStoredGender } from "./use-gender";
import { readTranslateMode } from "./use-translate-mode";

// Target character length per TTS request. Sentences are coalesced up to this
// size so each request covers several sentences and the voice stays continuous
// (one request per sentence resets prosody at every join - the per-bullet
// "voice jump" on long answers). Tune up for more continuity, down for lower
// per-batch latency.
const TTS_BATCH_TARGET_CHARS = 240;

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


export function useGeminiSession(
  defaultMicLang: string = "locale",
  cloudTranslationEnabled: boolean = true,
): UseGeminiSession {
  const tErr = useTranslations("errors");
  const locale = useLocale();
  const { ctxRef, ensure: ensureAudio } = useAudioContext();
  const chat = useChatMessages();

  const playerRef = useRef<AudioStreamPlayer | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const analyserAttachedRef = useRef(false);
  const speechRef = useRef<{
    controller: AbortController;
    active: boolean;
    openness: number | null;
  } | null>(null);
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
  const turnAbortRef = useRef<AbortController | null>(null);

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
    const player = playerRef.current;
    if (!avatarRef.current || !player) return;
    avatarRef.current.attachAnalyser(player.getAnalyser(), () => player.hasPlayback());
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
      const speech = speechRef.current;
      if (speech?.active) {
        avatar.setSpeakingOverride(true);
        avatar.setSpeakingOpenness(speech.openness);
      }
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

  const stopSpeechPlayback = useCallback(() => {
    const speech = speechRef.current;
    speechRef.current = null;
    if (speech) speech.controller.abort();
    else cancelBrowserTts();
    playerRef.current?.clear();
    avatarRef.current?.stopSpeaking();
  }, []);

  const teardownSession = useCallback(() => {
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    micWantedRef.current = false;
    sttFinalBufferRef.current = [];
    sttLangRef.current = "";
    recogniserRef.current?.stop();
    recogniserRef.current = null;
    streamerRef.current?.stop();
    streamerRef.current = null;
    stopSpeechPlayback();
    playerRef.current = null;
    analyserAttachedRef.current = false;
    setMicActive(false);
  }, [stopSpeechPlayback]);

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

  const speakClientReply = useCallback(
    async (text: string, lang: SupportedLang, gender: "female" | "male", signal: AbortSignal) => {
      if (signal.aborted || !ttsEnabledRef.current) return;
      const speech = { controller: new AbortController(), active: false, openness: null as number | null };
      speechRef.current = speech;
      const cancelSpeech = () => speech.controller.abort();
      signal.addEventListener("abort", cancelSpeech, { once: true });
      try {
        let failure = "playback";
        const played = await speakWithBrowserTts(text, {
          lang,
          gender,
          muted: audioMutedRef.current,
          signal: speech.controller.signal,
          onFailure: (reason) => { failure = reason; },
          onSpeakingChange: (speaking) => {
            if (speechRef.current !== speech) return;
            speech.active = speaking;
            avatarRef.current?.setSpeakingOverride(speaking);
          },
          onOpenness: (openness) => {
            if (speechRef.current !== speech) return;
            speech.openness = openness;
            avatarRef.current?.setSpeakingOpenness(openness);
          },
        });
        if (played || speech.controller.signal.aborted || !ttsEnabledRef.current) return;

        // Preserve the selected browser voice whenever it can play. Synthesize
        // PCM locally only when that path is unavailable.
        try {
          const pcm = await synthesizeDemoSpeech(text, lang, gender, speech.controller.signal);
          if (speech.controller.signal.aborted || !ttsEnabledRef.current) return;
          const player = playerRef.current;
          if (pcm?.length && player) {
            player.pushPcm(pcm, { in: true, out: true });
            await player.waitForIdle(speech.controller.signal);
            return;
          }
        } catch (err) {
          if (speech.controller.signal.aborted) return;
          console.warn("[useGeminiSession] Offline speech failed:", err);
        }
        const language = new Intl.DisplayNames([locale], { type: "language" }).of(lang === "zhTW" ? "zh-TW" : lang) ?? lang;
        setErrorMessage(tErr(failure === "voice-missing" ? "speechVoiceMissing" : "speechUnavailable", { language }));
      } finally {
        signal.removeEventListener("abort", cancelSpeech);
        if (speechRef.current === speech) {
          speechRef.current = null;
          avatarRef.current?.setSpeakingOverride(false);
        }
      }
    },
    [locale, tErr],
  );

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
        if (!receivedAudio && !signal.aborted && ttsEnabledRef.current) throw new Error("TTS returned no audio");
      } catch (err) {
        if (signal.aborted || !ttsEnabledRef.current) return;
        console.warn("[useGeminiSession] TTS failed, using client voice:", err);
        await playerRef.current?.waitForIdle(signal);
        await speakClientReply(text, lang, gender, signal);
      }
    },
    [speakClientReply],
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
      const translateMode = readTranslateMode();
      const sourceLang = translateMode.enabled ? langHint ?? detectLang(trimmed) : null;
      const targetLang = sourceLang === translateMode.langA ? translateMode.langB : translateMode.langA;
      const translateLocally = sourceLang && !cloudTranslationEnabled
        ? prepareLocalTranslation(trimmed, sourceLang, targetLang)
        : null;

      await ensureAudio();
      if (!playerRef.current) await connect();

      turnAbortRef.current?.abort();
      const abort = new AbortController();
      turnAbortRef.current = abort;
      stopSpeechPlayback();

      chat.pushFullUser(trimmed);
      setThinking(true);
      setErrorMessage(null);

      // Interpreter mode translates directly, bypassing classification and RAG.
      if (translateMode.enabled) {
        avatarRef.current?.onTalkStart(false);
        const askedAt = new Date().toISOString();
        let translated: string;
        let translationStatus: number | undefined;
        try {
          if (translateLocally) {
            translated = (await translateLocally(abort.signal)) ?? "";
          } else {
            const res = await fetch("/api/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: trimmed, targetLang }),
              signal: abort.signal,
            });
            translationStatus = res.status;
            if (!res.ok) throw new Error(`translate ${res.status}`);
            const json = (await res.json()) as { text?: string };
            translated = (json.text ?? "").trim();
          }
          if (!translated) throw new Error("Empty translation");
        } catch (err) {
          if (abort.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useGeminiSession] translate failed:", msg);
          const errorKey = translateLocally ? "translationDemoUnavailable"
            : translationStatus === 503 ? "translationUnavailable" : "translationFailed";
          setErrorMessage(tErr(errorKey));
          setThinking(false);
          avatarRef.current?.onTalkEnd();
          return;
        }

        if (abort.signal.aborted) return;
        setThinking(false);
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

      const askedAt = new Date().toISOString();
      const gender = readStoredGender();
      const replyLang = localeToSupportedLang(locale) ?? "en";
      avatarRef.current?.onTalkStart(false);

      let reply: { answer: string; citations: Citation[]; suggestions?: string[] };
      try {
        const response = await fetch("/api/demo-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: trimmed, locale, gender }),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`Chat failed: ${response.status}`);
        reply = await response.json();
        if (!reply.answer?.trim()) throw new Error("Empty reply");
      } catch {
        if (abort.signal.aborted) return;
        setThinking(false);
        setErrorMessage(tErr("chatFailed"));
        avatarRef.current?.onTalkEnd();
        return;
      }

      if (abort.signal.aborted) return;
      const id = chat.pushFullModel(formatMarkdownForDisplay(reply.answer), reply.citations);
      if (reply.suggestions?.length) chat.setSuggestionsForMessage(id, reply.suggestions);
      setThinking(false);
      logChat({
        question: trimmed,
        answer: reply.answer,
        questionAt: askedAt,
        answerAt: new Date().toISOString(),
        source: "web",
      });

      try {
        await speakClientReply(stripMarkdownForTts(reply.answer), replyLang, gender, abort.signal);
      } catch (err) {
        if (!abort.signal.aborted) console.warn("[useGeminiSession] Client speech failed:", err);
      } finally {
        if (!abort.signal.aborted) avatarRef.current?.onTalkEnd();
      }
    },
    [chat, cloudTranslationEnabled, connect, ensureAudio, locale, speakClientReply, speakSentences, stopSpeechPlayback, tErr],
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
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    stopSpeechPlayback();
    avatarRef.current?.onTalkEnd();
    setThinking(false);
  }, [stopSpeechPlayback]);

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

    const pickedLang = micLangRef.current;
    const translateMode = readTranslateMode();
    if (!cloudTranslationEnabled && translateMode.enabled && isStreamingLang(pickedLang)) {
      // The mic press supplies user activation before transcription finishes.
      const target = pickedLang === translateMode.langA ? translateMode.langB : translateMode.langA;
      void prepareBrowserTranslator(pickedLang, target);
    }

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
    cloudTranslationEnabled,
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
    if (ttsEnabledRef.current === enabled) return;
    ttsEnabledRef.current = enabled;
    if (!enabled) stopSpeechPlayback();
  }, [stopSpeechPlayback]);

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
