/**
 * @deprecated DEAD CODE 2026-05-28 - see `lib/gemini-session.ts` header.
 * Mic capture for the stable stack lives in the browser's Web Speech API
 * (`lib/speech-recogniser.ts`); we no longer stream raw PCM up to Live.
 */
import { downsample, floatToPcm16 } from "@/lib/audio-convert";
import type { GeminiLiveSession } from "@/lib/gemini-session";
import type { AudioStreamPlayer } from "@/lib/audio-stream-player";

const TARGET_RATE = 16000;
const CHUNK_MS = 100;
/** 100 ms at 16 kHz mono = 1600 samples = 3200 PCM16 bytes per chunk. */
const CHUNK_SAMPLES = (TARGET_RATE * CHUNK_MS) / 1000;

/**
 * Captures microphone audio, downsamples to 16 kHz PCM16, and streams it to
 * the Gemini Live session as 100 ms chunks.
 *
 * Push-to-talk: call `start()` on key/button down, `stop()` on release.
 *
 * NOTE: Uses the deprecated `ScriptProcessorNode` for simplicity. An
 * `AudioWorkletNode` would be more correct (no main-thread audio callback)
 * but requires shipping a separate worklet file. Migrate when the demo is
 * promoted to production.
 */
export class MicStreamer {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  private session: GeminiLiveSession | null = null;
  private player: AudioStreamPlayer | null = null;

  private capturing = false;
  private accumulator: Float32Array = new Float32Array(0);

  /**
   * Open mic and start streaming to the session. Mutes the playback queue
   * immediately so any in-flight model audio doesn't bleed into the mic via
   * the speakers.
   */
  async start(
    session: GeminiLiveSession,
    player: AudioStreamPlayer,
  ): Promise<void> {
    if (this.capturing) return;

    this.session = session;
    this.player = player;

    player.mute();

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const nativeRate =
      this.mediaStream.getAudioTracks()[0].getSettings().sampleRate ?? 48000;

    // Match AudioContext sampleRate to the device to avoid double resampling
    // by the browser before our downsample stage.
    this.audioContext = new AudioContext({ sampleRate: nativeRate });
    this.sourceNode = this.audioContext.createMediaStreamSource(
      this.mediaStream,
    );

    // bufferSize 4096 balances latency and glitch-free capture on most devices.
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (ev) => {
      if (!this.capturing) return;
      this.handleAudioProcess(ev, nativeRate);
    };

    this.sourceNode.connect(this.processorNode);
    // Connecting processor -> destination is required for `onaudioprocess` to
    // fire (browser quirk), even though we don't route mic to speakers.
    this.processorNode.connect(this.audioContext.destination);

    this.accumulator = new Float32Array(0);
    this.capturing = true;
  }

  /**
   * Close mic, flush any remaining buffered samples, and tell the server the
   * user's turn ended so it can respond without waiting for VAD timeout.
   */
  stop(): void {
    if (!this.capturing) return;
    this.capturing = false;

    if (this.accumulator.length > 0) {
      this.flushAccumulator();
    }

    this.session?.sendAudioStreamEnd();

    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.processorNode = null;
    this.sourceNode = null;

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;

    void this.audioContext?.close();
    this.audioContext = null;

    this.player?.unmute();
  }

  private handleAudioProcess(
    ev: AudioProcessingEvent,
    nativeRate: number,
  ): void {
    const raw = ev.inputBuffer.getChannelData(0);
    const resampled = downsample(raw, nativeRate, TARGET_RATE);

    const combined = new Float32Array(
      this.accumulator.length + resampled.length,
    );
    combined.set(this.accumulator);
    combined.set(resampled, this.accumulator.length);
    this.accumulator = combined;

    while (this.accumulator.length >= CHUNK_SAMPLES) {
      const slice = this.accumulator.slice(0, CHUNK_SAMPLES);
      const pcm = floatToPcm16(slice);
      this.session?.sendAudioChunk(pcm);
      this.accumulator = this.accumulator.slice(CHUNK_SAMPLES);
    }
  }

  private flushAccumulator(): void {
    if (this.accumulator.length === 0) return;
    const pcm = floatToPcm16(this.accumulator);
    this.session?.sendAudioChunk(pcm);
    this.accumulator = new Float32Array(0);
  }
}
