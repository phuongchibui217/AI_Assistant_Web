/**
 * @deprecated DEAD CODE 2026-05-28 - see `lib/gemini-session.ts` header.
 *
 * Wire-protocol types for the Gemini Live WebSocket API.
 *
 * One direction per section. The server multiplexes events on `ServerMessage` -
 * only one optional field is populated per frame; switch on the populated key
 * to dispatch.
 *
 * Reference: https://ai.google.dev/api/multimodal-live
 */

// ---------------------------------------------------------------------------
// CLIENT -> SERVER
// ---------------------------------------------------------------------------

/** First frame sent after the WebSocket opens. */
export type ClientSetupMessage = {
  setup: SetupConfig;
};

export type SetupConfig = {
  /** e.g. "models/gemini-2.5-flash-native-audio-preview-12-2025" */
  model: string;
  generationConfig: GenerationConfig;
  systemInstruction?: ContentPart;
  inputAudioTranscription?: TranscriptionConfig;
  outputAudioTranscription?: TranscriptionConfig;
  /**
   * Opt in to session resumption. Empty `handle` = start a new resumable
   * session; non-empty `handle` = continue a prior session by handle. The
   * server replies with `sessionResumptionUpdate` frames carrying the next
   * handle to use on reconnect.
   */
  sessionResumption?: SessionResumptionConfig;
};

export type SessionResumptionConfig = {
  handle?: string;
};

/** Sentinel empty object - presence of the field enables the feature. */
export type TranscriptionConfig = Record<string, never>;

export type GenerationConfig = {
  /** e.g. ["AUDIO"] */
  responseModalities: string[];
  speechConfig?: SpeechConfig;
  /**
   * Cap for the model reply length in tokens. The Live API default is small
   * enough that longer answers (e.g. a story) get cut mid-sentence. 8192 is
   * still well under the model's full context window and avoids runaway
   * replies.
   */
  maxOutputTokens?: number;
};

export type SpeechConfig = {
  voiceConfig: VoiceConfig;
};

export type VoiceConfig = {
  prebuiltVoiceConfig: PrebuiltVoiceConfig;
};

export type PrebuiltVoiceConfig = {
  /** e.g. "Aoede" */
  voiceName: string;
};

/** Realtime PCM audio chunk (user speaking). */
export type ClientRealtimeInputMessage = {
  realtimeInput: RealtimeInputAudio | RealtimeInputStreamEnd;
};

export type RealtimeInputAudio = {
  audio: {
    /** "audio/pcm;rate=16000" */
    mimeType: string;
    /** base64-encoded PCM16 LE */
    data: string;
  };
};

export type RealtimeInputStreamEnd = {
  audioStreamEnd: true;
};

/** Text turn (e.g. prompt user types into the input box). */
export type ClientContentMessage = {
  clientContent: ClientContent;
};

export type ClientContent = {
  turns: ContentPart[];
  turnComplete: boolean;
};

// ---------------------------------------------------------------------------
// SERVER -> CLIENT
// ---------------------------------------------------------------------------

/**
 * Server -> client envelope. Only one of the optional fields is set per frame.
 * Dispatch on the populated key.
 */
export type ServerMessage = {
  setupComplete?: SetupComplete;
  serverContent?: ServerContent;
  /** Function-call extension - unused in this client. */
  toolCall?: Record<string, unknown>;
  goAway?: GoAwayMessage;
  /**
   * Periodic checkpoint from the server. The latest `newHandle` should be
   * stashed and resent on the next setup as `sessionResumption.handle` to
   * resume the session (and its conversation history) after a goAway or
   * idle reconnect.
   */
  sessionResumptionUpdate?: SessionResumptionUpdate;
};

export type SessionResumptionUpdate = {
  newHandle?: string;
  resumable?: boolean;
};

/** Server acknowledges setup; ready to receive input. */
export type SetupComplete = Record<string, never>;

export type ServerContent = {
  /** Audio + text from the model. */
  modelTurn?: ContentPart;
  /** Transcript of what the user said (input audio STT). */
  inputTranscription?: Transcription;
  /** Transcript of what the model is speaking (output audio STT). */
  outputTranscription?: Transcription;
  turnComplete?: boolean;
  interrupted?: boolean;
};

export type Transcription = {
  text: string;
};

/** Server signals the session is about to terminate (e.g. 15-min cap). */
export type GoAwayMessage = {
  /** ISO 8601 duration, e.g. "PT5S". */
  timeLeft: string;
};

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * One content fragment - used for system instructions, audio chunks, and
 * text responses alike.
 */
export type ContentPart = {
  parts: Part[];
  /** "user" | "model" */
  role?: string;
};

export type Part = {
  text?: string;
  inlineData?: InlineData;
};

export type InlineData = {
  /** "audio/pcm" or "audio/wav" */
  mimeType: string;
  /** base64-encoded */
  data: string;
};
