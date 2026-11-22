import type { MouthAnimator } from "./mouth-animator";

/**
 * Drives openness from queued audio. Hysteresis smooths short silences within
 * playback, while an empty playback queue closes the mouth immediately.
 */

const RMS_THRESHOLD_ON = 0.006;
const RMS_THRESHOLD_OFF = 0.0025;
const ONSET_HOLD_MS = 0;
const OFFSET_HOLD_MS = 90;

// A running peak accommodates engines with different playback levels.
const ENV_ATTACK_TAU_S = 0.016;
const ENV_RELEASE_TAU_S = 0.062;
const ENV_FLOOR = 0.002;
const ENV_MIN_PEAK = 0.02;
// How fast the peak decays back toward ENV_MIN_PEAK between loud moments.
const ENV_PEAK_DECAY_TAU_S = 0.8;
const ENV_GAMMA = 0.62;

// Accent detection for secondary motion (e.g. a small eyebrow raise on a
// stressed syllable). Fire when openness rises past FIRE, re-arm only after it
// falls back below ARM, and enforce a minimum gap so rapid speech does not
// twitch the brows every syllable.
const ACCENT_FIRE = 0.62;
const ACCENT_ARM = 0.25;
const ACCENT_MIN_GAP_MS = 600;

export class LipSyncDriver {
  private readonly analyser: AnalyserNode;
  private readonly mouth: MouthAnimator;
  private readonly onSpeakingChange?: (speaking: boolean) => void;
  private readonly onAccent?: () => void;
  private readonly buffer: Float32Array;

  private trackingPlayback = false;
  private speaking = false;
  private candidateState: boolean | null = null;
  private candidateSinceMs = 0;
  private env = 0;
  private envPeak = ENV_MIN_PEAK;
  private accentArmed = true;
  private accentCooldownMs = 0;

  constructor(
    analyser: AnalyserNode,
    mouth: MouthAnimator,
    onSpeakingChange?: (speaking: boolean) => void,
    onAccent?: () => void,
    private readonly hasPlayback: () => boolean = () => true,
  ) {
    this.analyser = analyser;
    this.mouth = mouth;
    this.onSpeakingChange = onSpeakingChange;
    this.onAccent = onAccent;
    this.buffer = new Float32Array(analyser.fftSize);
  }

  reset(): void {
    const wasSpeaking = this.speaking;
    this.trackingPlayback = false;
    this.speaking = false;
    this.candidateState = null;
    this.candidateSinceMs = 0;
    this.env = 0;
    this.envPeak = ENV_MIN_PEAK;
    this.accentArmed = true;
    this.mouth.stopSpeech();
    if (wasSpeaking) this.onSpeakingChange?.(false);
  }

  update(dt: number): void {
    if (!this.hasPlayback()) {
      if (this.trackingPlayback) this.reset();
      return;
    }
    this.trackingPlayback = true;
    this.analyser.getFloatTimeDomainData(
      this.buffer as Float32Array<ArrayBuffer>,
    );
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      sum += this.buffer[i] * this.buffer[i];
    }
    const rms = Math.sqrt(sum / this.buffer.length);

    // Envelope follower -> mouth openness (amplitude mode; no-op in cycle mode).
    // Read on the same node that's playing, so it is inherently in sync - no
    // offset hold, which is what makes the openness track the audio without lag.
    const tau = rms > this.env ? ENV_ATTACK_TAU_S : ENV_RELEASE_TAU_S;
    this.env += (rms - this.env) * (1 - Math.exp(-dt / tau));
    // Adaptive peak: rises instantly to a louder envelope, decays slowly toward
    // the floor otherwise. Normalising against it auto-calibrates the mouth to
    // whatever the raw audio level is.
    if (this.env > this.envPeak) {
      this.envPeak = this.env;
    } else {
      this.envPeak += (ENV_MIN_PEAK - this.envPeak) * (1 - Math.exp(-dt / ENV_PEAK_DECAY_TAU_S));
    }
    const norm = Math.max(0, Math.min(1, (this.env - ENV_FLOOR) / (this.envPeak - ENV_FLOOR)));
    const openness = Math.pow(norm, ENV_GAMMA);
    this.mouth.setOpenness(openness);

    // Secondary motion: fire an accent on a strong rising edge of openness.
    if (this.accentCooldownMs > 0) this.accentCooldownMs -= dt * 1000;
    if (openness < ACCENT_ARM) this.accentArmed = true;
    if (this.accentArmed && this.accentCooldownMs <= 0 && openness > ACCENT_FIRE) {
      this.accentArmed = false;
      this.accentCooldownMs = ACCENT_MIN_GAP_MS;
      this.onAccent?.();
    }

    const desired =
      rms > RMS_THRESHOLD_ON
        ? true
        : rms < RMS_THRESHOLD_OFF
          ? false
          : this.speaking; // inside hysteresis band - keep current

    if (desired !== this.speaking) {
      if (this.candidateState !== desired) {
        this.candidateState = desired;
        this.candidateSinceMs = 0;
      }
      this.candidateSinceMs += dt * 1000;
      // Close gently across brief gaps while there is still queued audio.
      const holdMs = desired ? ONSET_HOLD_MS : OFFSET_HOLD_MS;
      if (this.candidateSinceMs >= holdMs) {
        this.speaking = desired;
        this.candidateState = null;
        this.mouth.setSpeaking(desired);
        this.onSpeakingChange?.(desired);
      }
    } else {
      this.candidateState = null;
    }
  }
}
