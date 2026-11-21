import type { MouthAnimator } from "./mouth-animator";

/**
 * Reads RMS amplitude from an AnalyserNode tapped on the playback queue and
 * converts it into a binary "speaking" signal driving the mouth animator.
 *
 * Hysteresis: a single threshold causes flicker on the silence-edge of every
 * chunk, so we use two thresholds.
 *
 * Asymmetric debounce (Unity parity, 2026-05-29): onset is INSTANT so the
 * mouth opens the moment the first audio sample crosses the ON threshold;
 * offset waits `OFFSET_HOLD_MS` (300ms, matching Unity GeminiLipSyncBridge
 * `_voiceOffDelay = 0.3f`) before flipping the flag off. This:
 *   - keeps the mouth visibly cycling across inter-sentence gaps in Cloud
 *     TTS playback (~100-300ms of silence between sentences),
 *   - feeds the downstream MouthAnimator briefSilence + slow-close so the
 *     full mouth-close timeline ≈ Unity's ~0.9s VoiceResultTimeTest budget,
 *   - removes the symmetric 60ms onset lag that made web mouth feel
 *     "behind" the audio at the start of an utterance.
 */

const RMS_THRESHOLD_ON = 0.02;
const RMS_THRESHOLD_OFF = 0.005;
const ONSET_HOLD_MS = 0;
const OFFSET_HOLD_MS = 300;

// Envelope follower for amplitude-driven mouth openness (male). Fast attack so
// the mouth opens crisply on a syllable onset; slower release so it does not
// chatter between syllables. Time constants in seconds.
const ENV_ATTACK_TAU_S = 0.02;
const ENV_RELEASE_TAU_S = 0.11;
// Map the smoothed RMS to openness 0..1. Below FLOOR the mouth is closed; at/
// above CEIL it is fully open. GAMMA < 1 lifts quiet speech so mid-volume still
// opens the mouth noticeably (a linear map leaves normal speech barely open).
// Openness = envelope normalised against a running PEAK (adaptive gain) rather
// than a fixed ceiling. The analyser taps the RAW pre-gain signal whose
// absolute level is unknown and varies by TTS engine, so a hard ceiling either
// leaves the mouth shut (ceiling too high) or pinned open (too low). The
// adaptive peak makes the mouth open fully on the loudest recent speech
// whatever the level. GAMMA < 1 lifts quieter syllables.
const ENV_FLOOR = 0.005;
// The peak never drops below this, so silence/room-noise can't be amplified up
// into an open mouth. Matches the old binary "speaking" ON threshold.
const ENV_MIN_PEAK = 0.02;
// How fast the peak decays back toward ENV_MIN_PEAK between loud moments.
const ENV_PEAK_DECAY_TAU_S = 0.8;
const ENV_GAMMA = 0.5;

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
  ) {
    this.analyser = analyser;
    this.mouth = mouth;
    this.onSpeakingChange = onSpeakingChange;
    this.onAccent = onAccent;
    this.buffer = new Float32Array(analyser.fftSize);
  }

  update(dt: number): void {
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
      // Asymmetric: 0ms for onset (open immediately), OFFSET_HOLD_MS for
      // closing (hold open through inter-sentence silences).
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
