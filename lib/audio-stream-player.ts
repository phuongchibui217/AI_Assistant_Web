import { pcm16ToFloat } from "./audio-convert";
import { LinearResampler } from "./audio-resample";

/**
 * Gemini Live returns mono PCM16 at 24 kHz.
 *
 * The playback `AudioContext` should be created at this rate too (see
 * `createPlaybackContext()` in `hooks/use-audio-context.ts`). If buffer rate
 * and context rate disagree, Chrome resamples every scheduled buffer
 * independently and corrupts the samples at each chunk seam - the root cause
 * of the client's "ビー" beep. See `audio-resample.ts` for the measurements.
 */
export const PLAYBACK_RATE = 24000;

/**
 * Make-up gain applied after the leveller. Cloud TTS synthesises each sentence
 * independently at a moderate level (~0.1 RMS), which is too quiet on phone
 * speakers (the user had to max the device volume). The leveller compresses the
 * sentence-to-sentence variation, then this gain lifts the whole thing. The
 * downstream brick-wall limiter guarantees the boosted signal can never clip,
 * so raising this stays click-free. Tunable if the demo wants louder/softer.
 */
const MAKEUP_GAIN = 2;

/**
 * Lip-sync look-ahead. A DelayNode sits AFTER the analyser tap, so the analyser
 * reads each sample ~this many seconds BEFORE it reaches the speakers. The mouth
 * (driven by the analyser) therefore leads the sound slightly, cancelling the
 * animation pipeline latency (render frame + envelope attack) so the opening
 * lands in sync instead of trailing. SALSA calls this "playhead bias". 50 ms is
 * imperceptible as an audio delay but covers ~1-2 frames + the envelope attack.
 */
const LIP_SYNC_LOOKAHEAD_S = 0.05;

/**
 * Plays a stream of PCM16 mono chunks from Gemini Live using Web Audio.
 *
 * Strategy: each chunk becomes its own `AudioBufferSourceNode` scheduled at
 * `nextStartFrame` (the previous chunk's end). Web Audio handles backpressure
 * internally - no manual ring buffer needed.
 *
 * An `AnalyserNode` sits between the source and the destination so the
 * lip-sync driver can read live amplitude after queue scheduling.
 */
export class AudioStreamPlayer {
  private readonly audioContext: AudioContext;
  private readonly analyser: AnalyserNode;
  /** Evens out the per-sentence loudness variation (each Cloud TTS sentence is
   *  synthesised independently, so levels drift ~3 dB between them). Gentle so
   *  speech stays natural; the brick-wall limiter below does the hard clip
   *  protection. */
  private readonly compressor: DynamicsCompressorNode;
  /** Sits after the make-up gain so a user-level mute can drop the speaker
   *  volume without tearing down playback (feedback item 23). Unmuted value is
   *  MAKEUP_GAIN, not 1. */
  private readonly gainNode: GainNode;
  /** Brick-wall safety limiter, last in the chain. Catches any transient that
   *  the leveller + make-up gain pushes toward 0 dBFS so the output can never
   *  clip - clipping was the "tách tách" crackle of the old Live stack. */
  private readonly limiter: DynamicsCompressorNode;
  /** Delays the audible path after the analyser tap so lip-sync leads by
   *  LIP_SYNC_LOOKAHEAD_S (see constant). */
  private readonly lookAhead: DelayNode;
  /** Only non-null when the context could NOT be opened at PLAYBACK_RATE. It
   *  converts chunks to the context's rate with interpolation state carried
   *  across calls, so seams stay continuous - never let the browser resample
   *  per buffer instead (see audio-resample.ts). */
  private readonly resampler: LinearResampler | null;
  /** Rate the AudioBuffers are built at - always the context's own rate. */
  private readonly bufferRate: number;

  /**
   * Next scheduling target, as an integer frame count at the context's rate.
   * 0 means idle (nothing queued).
   *
   * Frames, not seconds: accumulating `start + duration` in float seconds
   * drifts the targets off the frame grid, so each buffer lands between two
   * samples and the browser has to place it by interpolation. The measured
   * drift is small (~4e-9 frames over 750 chunks) and was NOT the cause of the
   * beep - it is bounded-but-unbounded-in-principle bookkeeping error that
   * grows with session length, and integer frames remove it for free.
   */
  private nextStartFrame = 0;

  /** Sources still pending so we can stop them on mute / interrupt. */
  private queuedSources: AudioBufferSourceNode[] = [];

  /** When true, incoming chunks are dropped (e.g. while user is talking). */
  private muted = false;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.bufferRate = audioContext.sampleRate;
    this.resampler =
      audioContext.sampleRate === PLAYBACK_RATE
        ? null
        : new LinearResampler(PLAYBACK_RATE, audioContext.sampleRate);

    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    // Leveller: gentle (ratio 3, soft knee, slow release) so it tames the
    // louder sentences toward the quieter ones without audible pumping.
    this.compressor = audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.25;

    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = MAKEUP_GAIN;

    // Brick-wall limiter: near-0 dB threshold, high ratio, fast attack. In
    // normal speech the leveller+make-up peak sits below this, so it stays
    // transparent; it only clamps rare transient overshoot, guaranteeing the
    // output never exceeds ~-1 dBFS and therefore never clips.
    this.limiter = audioContext.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.0005;
    this.limiter.release.value = 0.1;

    this.lookAhead = audioContext.createDelay(1);
    this.lookAhead.delayTime.value = LIP_SYNC_LOOKAHEAD_S;

    // source(s) → analyser (lip-sync taps the RAW envelope here, undelayed) →
    // lookAhead delay → leveller → make-up/mute gain → limiter → speakers.
    // The delay is downstream of the analyser, so the mouth reads audio that is
    // heard LIP_SYNC_LOOKAHEAD_S later (leads the sound to cancel render lag).
    this.analyser.connect(this.lookAhead);
    this.lookAhead.connect(this.compressor);
    this.compressor.connect(this.gainNode);
    this.gainNode.connect(this.limiter);
    this.limiter.connect(audioContext.destination);
  }

  /**
   * Push one PCM16 chunk into the playback queue.
   *
   * The scheduler picks `max(currentTime + headroom, lastEndTime)` so chunks
   * stay contiguous when the queue is full but resume promptly after drain.
   *
   * `fade` applies a 5 ms in/out gain envelope. A streamed TTS batch is many
   * contiguous chunks of ONE generative take: only the FIRST chunk gets
   * `fade.in` (masks the seam with the previous batch / start-after-silence
   * click) and only the LAST gets `fade.out` (masks the seam to the next
   * batch, whose endpoint samples aren't exactly zero). Middle chunks pass no
   * fade - fading them would dip the continuous take. An underrun restart
   * always fades in regardless.
   */
  pushPcm(pcm: Uint8Array, fade: { in?: boolean; out?: boolean } = {}): void {
    if (this.muted) return;

    // Convert to the context's rate HERE, carrying interpolation state between
    // chunks, instead of handing the context a buffer at a different rate and
    // letting it resample each one independently (that is what corrupts every
    // seam on Chrome). No-op on the normal path, where the context already
    // runs at PLAYBACK_RATE and `resampler` is null.
    const floatSamples = this.resampler
      ? this.resampler.process(pcm16ToFloat(pcm))
      : pcm16ToFloat(pcm);
    const numFrames = floatSamples.length;
    // A chunk too short to yield a whole output sample produces nothing yet -
    // its samples stay in the resampler and emerge on a later push. Bail out
    // before nextStartFrame is touched so the schedule stays contiguous.
    if (numFrames === 0) return;
    const duration = numFrames / this.bufferRate;

    // Build the buffer/source BEFORE reading currentTime below. copyToChannel
    // is a real memcpy and can stall under main-thread jank (GC pause,
    // background-tab throttling). Reading currentTime AFTER this work (not
    // before) keeps the schedule decision based on the time closest to when
    // start() actually runs, instead of a snapshot that's already stale by the
    // time the copy finishes.
    const buffer = this.audioContext.createBuffer(1, numFrames, this.bufferRate);
    // TS 5 narrowed Float32Array generic to distinguish ArrayBuffer vs
    // SharedArrayBuffer; copyToChannel only accepts ArrayBuffer-backed views.
    buffer.copyToChannel(floatSamples as Float32Array<ArrayBuffer>, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Scheduling strategy (rewritten again 2026-05-28 after the per-turn
    // jitter feedback - "click ở cuối RAG 1, click nhiều ở RAG 2"):
    // - First chunk of a fresh turn (nextStartFrame===0 after clear()): add a
    //   200 ms jitter buffer so Live's chunks have time to accumulate a
    //   runway before playback starts. Without this, Live's natural chunk
    //   arrival jitter (50-150 ms gaps near the end of long answers) causes
    //   the player to underrun repeatedly, and each underrun's fade-in
    //   compounds into audible amplitude modulation.
    // - Mid-turn with runway: schedule contiguously (no gap, no click).
    // - Mid-turn underrun: schedule immediately and mark for fade-in so the
    //   non-zero-cross restart is masked. Better than padding silence which
    //   sounds worse (longer drop-out before the click).
    const ctxTime = this.audioContext.currentTime;
    const isFirstChunk = this.nextStartFrame === 0;
    const nextStartTime = this.nextStartFrame / this.bufferRate;
    const isUnderrun = !isFirstChunk && nextStartTime <= ctxTime;
    const JITTER_BUFFER_S = 0.2;
    let target: number;
    if (isFirstChunk) {
      target = ctxTime + JITTER_BUFFER_S;
    } else if (nextStartTime > ctxTime) {
      target = nextStartTime;
    } else {
      target = ctxTime;
    }
    // Snap to an exact frame so the buffer lands on the sample grid rather
    // than between two samples (see nextStartFrame).
    const startFrame = Math.round(target * this.bufferRate);
    const startAt = startFrame / this.bufferRate;

    const wantFadeIn = isUnderrun || fade.in === true;
    const wantFadeOut = fade.out === true;
    if (wantFadeIn || wantFadeOut) {
      const FADE_S = 0.005;
      const f = Math.min(FADE_S, duration / 2);
      const gain = this.audioContext.createGain();
      if (wantFadeIn) {
        // Ramp up from silence - masks a non-zero-sample restart click.
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(1, startAt + f);
      } else {
        // Fade-out only: hold full level until the tail ramp so a mid-batch
        // chunk that is the LAST of its take doesn't start with a dip.
        gain.gain.setValueAtTime(1, startAt);
      }
      if (wantFadeOut) {
        // Ramp to silence at the take's end so the next take's start doesn't click.
        gain.gain.setValueAtTime(1, startAt + duration - f);
        gain.gain.linearRampToValueAtTime(0, startAt + duration);
      }
      source.connect(gain);
      gain.connect(this.analyser);
    } else {
      source.connect(this.analyser);
    }

    this.nextStartFrame = startFrame + numFrames;

    this.queuedSources.push(source);
    source.onended = () => {
      const idx = this.queuedSources.indexOf(source);
      if (idx !== -1) this.queuedSources.splice(idx, 1);
    };

    source.start(startAt);
  }

  /**
   * Push-to-talk suppression. Drops any already-queued chunks and refuses new
   * pushes until {@link unmute} is called. Used by the mic streamer to stop
   * model audio bleeding into the mic via the speakers.
   *
   * Distinct from {@link setVolumeMuted} which only changes the output gain
   * without disrupting playback - the user-facing mute button must NOT use
   * this method, otherwise unmuting will not resume the in-progress reply
   * (feedback item 23, 2026-05-25).
   */
  mute(): void {
    this.muted = true;
    this.clear();
  }

  unmute(): void {
    this.muted = false;
  }

  /**
   * User-facing speaker mute: silences output while letting playback continue
   * underneath. Lip-sync analyser still receives signal so the avatar's mouth
   * keeps moving in sync with the answer the user has chosen not to hear.
   */
  setVolumeMuted(muted: boolean): void {
    this.gainNode.gain.value = muted ? 0 : MAKEUP_GAIN;
  }

  /** Wait until queued PCM and the delayed output have finished. */
  waitForIdle(signal: AbortSignal): Promise<void> {
    const isIdle = () =>
      signal.aborted ||
      this.nextStartFrame === 0 ||
      this.audioContext.state === "closed" ||
      this.audioContext.currentTime >= this.nextStartFrame / this.bufferRate + LIP_SYNC_LOOKAHEAD_S + 0.02;
    if (isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        window.clearInterval(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = window.setInterval(() => {
        if (isIdle()) finish();
      }, 30);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  /**
   * Cancel all queued playback immediately. Use on server-side `interrupted`
   * signal or when starting push-to-talk.
   */
  clear(): void {
    for (const src of this.queuedSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Source may have ended naturally - safe to ignore.
      }
    }
    this.queuedSources = [];
    this.nextStartFrame = 0;
    // Drop any half-consumed sample straddling the cancelled turn's last
    // chunk, so it can't be interpolated into the first chunk of the next one.
    this.resampler?.reset();
  }

  /** Analyser node tapped post-queue; reflects audio actually being played. */
  getAnalyser(): AnalyserNode {
    return this.analyser;
  }
}
