import * as THREE from "three";

/**
 * Drives the 8-frame mouth cycle with alpha cross-fade between adjacent
 * frames. Ports the Unity `AIAvatarManagerSP.UpdateLip()` state machine.
 *
 * Behaviour summary (ported from Unity):
 * - While speaking, cycle frames 0 -> 7 -> 0 with `FRAME_TIME_FAST` seconds
 *   per step.
 * - Outgoing frame fades out at `FADE_OUT_RATE` per second.
 * - Incoming frame fades in at `FADE_IN_RATE` per second.
 * - While silent, the "closed" silent sprite is fully visible.
 * - Brief silence inside a turn shows the "silent open" sprite for at most
 *   `BRIEF_SILENCE_MAX_S` before reverting to fully closed.
 */

type MouthMeshes = {
  /** 8 sprites for the speaking cycle (Mouth_00..Mouth_07). */
  cycle: readonly THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  silentClosed: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  silentOpen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
};

// Mouth cycle / fade timing - matches Unity AIAvatarManagerSP.UpdateLip.
// Web previously tried 0.09 (raw Unity frame interval) but 2D sprite cycling
// at that pace felt jittery vs. the Unity 3D rig that interpolates between
// poses; 0.12 reads smoother on 2D (user validated 2026-05-29).
const FRAME_TIME_FAST = 0.12;
const FRAME_TIME_SLOW = 0.3;
const FADE_OUT_RATE = 15;
const FADE_IN_RATE = 10;
// Default close rate for cycle-mode transitions.
const SLOW_CLOSE_RATE = 1 / FRAME_TIME_SLOW;
const BRIEF_SILENCE_MAX_S = 0.27;
/**
 * Alpha below this snaps to 0. Ports Unity's `if (alpha < 0.1f) alpha = 0f`
 * - avoids long tails of near-invisible sprites bleeding through under the
 *   newer (currently fading in) frame.
 */
const FADE_OUT_SNAP = 0.1;

type Phase = "speaking" | "briefSilence" | "silent";

/** Per-character cross-fade tuning. Lower rate = slower (longer) fade. */
export type MouthFadeTuning = {
  fadeInRate?: number;
  fadeOutRate?: number;
  /** Seconds per cycle frame (defaults to FRAME_TIME_FAST). */
  frameTime?: number;
  /**
   * Rate the closed-mouth sprite fades in at end-of-utterance (defaults to the
   * slow ~0.3s ease). Characters whose backdrop has NO mouth (e.g. the male's
   * full-face backdrop) must close FAST so the mouthless backdrop is never
   * exposed in the gap while the cycle has faded out but the closed mouth hasn't
   * faded in yet.
   */
  silentCloseRate?: number;
  /**
   * "cycle" (default): time-based frame loop while speaking.
   * "amplitude": the frame index tracks the audio envelope fed via
   * `setOpenness` (quiet -> closed frame 0, loud -> open last frame) so the
   * mouth opening matches the audio instead of running on a fixed timer.
   */
  mode?: "cycle" | "amplitude";
  /**
   * Minimum seconds a mouth frame is held in amplitude mode before switching
   * (defaults to AMP_MIN_FRAME_TIME_S). Shorter values (e.g. 0.075s) give
   * crisper syllable response when paired with a fast fadeInRate.
   */
  minFrameTime?: number;
  /** Blend adjacent amplitude frames instead of stepping to a single pose. */
  blendAdjacentFrames?: boolean;
  /** Use pre-rendered transitions without compositing two mouth poses. */
  singleAmplitudePose?: boolean;
};

// Amplitude mode: how fast the shown openness eases toward the target fed by
// the lip-sync envelope. The envelope is already smoothed; this short ease just
// stops the discrete frame index from chattering at a value boundary.
const OPENNESS_EASE_TAU_S = 0.035;

// Amplitude mode: minimum time a mouth frame is held before it may change. Caps
// the sprite swap rate (~10/s) so the mouth does not flicker through many frames
// faster than the 2-frame cross-fade can settle - real lip motion changes shape
// roughly this often anyway.
const AMP_MIN_FRAME_TIME_S = 0.13;

const BLENDED_OPENNESS_EASE_TAU_S = 0.043;
// Keep loud peaks within the smaller speaking poses.
const BLENDED_MAX_OPENNESS = 0.58;
const POSE_ATTACK_S = 0.046;
const POSE_RELEASE_S = 0.071;
const POSE_END_RELEASE_S = 0.021;

export class MouthAnimator {
  private readonly meshes: MouthMeshes;
  // Per-character so the male (whose frames open/close further apart) can fade
  // slower than the female to smooth its larger movement.
  private readonly fadeInRate: number;
  private readonly fadeOutRate: number;
  private readonly frameTime: number;
  private readonly silentCloseRate: number;
  private readonly mode: "cycle" | "amplitude";
  private readonly minFrameTime: number;
  private readonly blendAdjacentFrames: boolean;
  private readonly singleAmplitudePose: boolean;

  private phase: Phase = "silent";
  private cycleIndex = 0;
  private prevCycleIndex: number | null = null;
  private cycleDirection: 1 | -1 = 1;
  private frameElapsed = 0;
  private briefSilenceElapsed = 0;
  private speaking = false;
  // Amplitude mode: target (from the lip-sync envelope) and the eased value
  // actually driving the frame index.
  private opennessTarget = 0;
  private openness = 0;
  // Amplitude mode: time the current frame has been held (for the min-frame gate).
  private amplitudeHoldElapsed = 0;
  // Fallback speaking drive (e.g. browser speechSynthesis where no WebAudio
  // AnalyserNode is available): drives a natural synthetic syllable envelope
  // for amplitude-mode mouths alongside cycle-mode `setSpeaking`.
  private syntheticSpeaking = false;
  private syntheticElapsed = 0;
  private externalOpenness: number | null = null;
  private fastClosing = false;

  constructor(meshes: MouthMeshes, tuning?: MouthFadeTuning) {
    this.meshes = meshes;
    this.fadeInRate = tuning?.fadeInRate ?? FADE_IN_RATE;
    this.fadeOutRate = tuning?.fadeOutRate ?? FADE_OUT_RATE;
    this.frameTime = tuning?.frameTime ?? FRAME_TIME_FAST;
    this.silentCloseRate = tuning?.silentCloseRate ?? SLOW_CLOSE_RATE;
    this.mode = tuning?.mode ?? "cycle";
    this.minFrameTime = tuning?.minFrameTime ?? AMP_MIN_FRAME_TIME_S;
    this.blendAdjacentFrames = this.mode === "amplitude" && tuning?.blendAdjacentFrames === true;
    this.singleAmplitudePose = this.mode === "amplitude" && tuning?.singleAmplitudePose === true;
    if (this.blendAdjacentFrames) {
      // renderOrder takes precedence over z for transparent meshes.
      this.meshes.silentClosed.renderOrder = 101;
    }
    this.applyInitialAlpha();
  }

  /**
   * Prepare amplitude mode when entering an active utterance (including rapid
   * consecutive sentences while the previous sentence is still fading back to
   * silentClosed). Keeps `cycle[cycleIndex]` cleanly visible behind
   * `silentClosed` so fading `silentClosed` out never flashes the backdrop.
   */
  private enterAmplitudeSpeaking(): void {
    if (this.blendAdjacentFrames || this.singleAmplitudePose) return;

    this.prevCycleIndex = null;
    this.amplitudeHoldElapsed = this.minFrameTime;
    const active = Math.max(0, Math.min(this.meshes.cycle.length - 1, this.cycleIndex));
    this.cycleIndex = active;
    for (let i = 0; i < this.meshes.cycle.length; i++) {
      this.meshes.cycle[i].material.opacity = i === active ? 1 : 0;
      this.meshes.cycle[i].renderOrder = i === active ? 100 : 0;
    }
    this.meshes.silentOpen.material.opacity = 0;
  }

  /**
   * Amplitude mode only: set the current mouth openness (0 = closed .. 1 = fully
   * open) from the lip-sync envelope. No-op in cycle mode.
   */
  setOpenness(openness: number): void {
    this.opennessTarget = Math.max(0, Math.min(1, openness));
  }

  /** Drive from a high-level voice signal (e.g. lip-sync RMS > threshold). */
  setSpeaking(isSpeaking: boolean): void {
    const wasActive = this.speaking || this.syntheticSpeaking;
    if (isSpeaking) this.fastClosing = false;
    if (isSpeaking && this.phase !== "speaking") {
      this.phase = "speaking";
      this.cycleIndex = 0;
      this.cycleDirection = 1;
      this.frameElapsed = 0;
    } else if (!isSpeaking && this.phase === "speaking") {
      this.phase = "briefSilence";
      this.briefSilenceElapsed = 0;
    }
    this.speaking = isSpeaking;
    if (this.mode === "amplitude" && isSpeaking && !wasActive) {
      this.enterAmplitudeSpeaking();
    }
  }

  /** Drive mouth animation without an audio AnalyserNode (both cycle and amplitude modes). */
  setSyntheticSpeaking(isSpeaking: boolean): void {
    if (!isSpeaking) {
      this.stopSpeech();
      return;
    }
    const wasActive = this.speaking || this.syntheticSpeaking;
    this.syntheticSpeaking = true;
    this.setSpeaking(true);
    if (this.mode === "amplitude" && !wasActive) {
      this.enterAmplitudeSpeaking();
    }
  }

  stopSpeech(): void {
    this.syntheticSpeaking = false;
    this.externalOpenness = null;
    this.opennessTarget = 0;
    if (!this.blendAdjacentFrames && !this.singleAmplitudePose) this.openness = 0;
    this.syntheticElapsed = 0;
    this.speaking = false;
    this.amplitudeHoldElapsed = this.minFrameTime;
    this.phase = "silent";
    this.fastClosing = true;
  }

  /**
   * Optional per-frame openness override (0..1) from `speechSynthesis`
   * `onboundary` / punctuation pause tracking. Pass `null` to fall back to the
   * estimated syllable oscillator while `syntheticSpeaking` is active.
   */
  setSyntheticOpenness(openness: number | null): void {
    this.externalOpenness =
      openness === null ? null : Math.max(0, Math.min(1, openness));
    // Allow immediate close to temporary speaking-closed Mouth_00 on a pause.
    if (openness === 0) {
      this.amplitudeHoldElapsed = Math.max(this.amplitudeHoldElapsed, this.minFrameTime);
    }
  }

  update(dt: number): void {
    if (this.mode === "amplitude") {
      const isActiveSpeech = this.speaking || this.syntheticSpeaking;
      if (this.syntheticSpeaking) {
        if (this.externalOpenness !== null) {
          this.opennessTarget = this.externalOpenness;
        } else {
          this.syntheticElapsed += dt;
          // Natural syllable rhythm spanning all 6 speaking shapes (0..5)
          // when the browser voice omits `onboundary`.
          const env =
            0.50 +
            0.34 * Math.sin(this.syntheticElapsed * 13.0) +
            0.22 * Math.sin(this.syntheticElapsed * 21.7 + 1.1) +
            0.12 * Math.sin(this.syntheticElapsed * 7.3 + 2.4);
          const opening = Math.max(0, Math.min(1, env));
          // Without word timing, keep the estimated jaw motion within a small
          // talking range. Every guessed syllable needn't reach a full vowel.
          this.opennessTarget = this.singleAmplitudePose ? opening * 0.55 : opening;
        }
      }
      if (this.singleAmplitudePose) {
        this.tickSingleAmplitude(dt, isActiveSpeech);
      } else if (this.blendAdjacentFrames) {
        this.tickBlendedAmplitude(dt, isActiveSpeech);
      } else if (isActiveSpeech) {
        this.tickAmplitude(dt);
      } else {
        this.tickAmplitudeIdle(dt);
      }
      return;
    }
    if (this.phase === "speaking") {
      this.tickSpeaking(dt);
    } else if (this.phase === "briefSilence") {
      this.tickBriefSilence(dt);
    } else {
      this.tickSilent(dt);
    }
  }

  private tickSingleAmplitude(dt: number, speaking: boolean): void {
    const target = speaking ? this.opennessTarget : 0;
    const opening = target > this.openness;
    const tau = this.fastClosing ? POSE_END_RELEASE_S : opening ? POSE_ATTACK_S : POSE_RELEASE_S;
    const delta = (target - this.openness) * (1 - Math.exp(-dt / tau));
    const maxStep = dt * (this.fastClosing ? 20 : 11);
    this.openness += THREE.MathUtils.clamp(delta, -maxStep, maxStep);

    const index = Math.round(this.openness * (this.meshes.cycle.length - 1));
    const resting = !speaking && index === 0;
    this.meshes.silentClosed.material.opacity = resting ? 1 : 0;
    this.meshes.silentClosed.visible = resting;
    for (const [i, mesh] of this.meshes.cycle.entries()) {
      mesh.visible = !resting && i === index;
      mesh.material.opacity = mesh.visible ? 1 : 0;
    }
  }

  private tickBlendedAmplitude(dt: number, speaking: boolean): void {
    const target = speaking ? this.opennessTarget * BLENDED_MAX_OPENNESS : 0;
    const tau = this.fastClosing ? 0.025 : BLENDED_OPENNESS_EASE_TAU_S;
    const ease = 1 - Math.exp(-dt / tau);
    this.openness += (target - this.openness) * ease;
    if (target === 0 && this.openness < 0.01) this.openness = 0;

    const closed = this.meshes.silentClosed.material;
    const closeRate = this.fastClosing ? Math.max(this.silentCloseRate, 18) : this.silentCloseRate;
    this.fadeMaterial(closed, speaking ? 0 : 1, dt, speaking ? this.fadeInRate : closeRate);

    const position = this.openness * (this.meshes.cycle.length - 1);
    const lower = Math.floor(position);
    const upperOpacity = position - lower;
    const showSpeakingFrames = closed.opacity < 1;
    for (let i = 0; i < this.meshes.cycle.length; i++) {
      const frame = this.meshes.cycle[i];
      frame.material.opacity = 0;
      if (showSpeakingFrames && i === lower) {
        frame.material.opacity = 1;
        frame.renderOrder = 50;
      } else if (showSpeakingFrames && i === lower + 1) {
        // A solid lower pose under the upper pose keeps the backdrop covered.
        frame.material.opacity = upperOpacity;
        frame.renderOrder = 100;
      }
    }
    if (!showSpeakingFrames) {
      this.openness = 0;
      this.fastClosing = false;
    }
  }

  /**
   * Amplitude mode while completely silent (between utterances / idle):
   * smoothly return to `silentClosed` (100% original base photo, at zSilent
   * above the cycle frames) and hard-zero every speaking cycle sprite once
   * covered so idle renders ONLY the original base mouth with zero overlap.
   */
  private tickAmplitudeIdle(dt: number): void {
    this.meshes.silentOpen.material.opacity = 0;
    const sc = this.meshes.silentClosed.material;
    if (sc.opacity < 1) {
      const rate = this.fastClosing ? Math.max(this.silentCloseRate, 24) : this.silentCloseRate;
      sc.opacity = Math.min(1, sc.opacity + dt * rate);
      if (sc.opacity >= 0.98) {
        sc.opacity = 1;
        this.fastClosing = false;
        this.prevCycleIndex = null;
        this.cycleIndex = 0;
        this.openness = 0;
        this.opennessTarget = 0;
        for (const m of this.meshes.cycle) {
          m.material.opacity = 0;
          m.renderOrder = 0;
        }
      }
    } else {
      this.fastClosing = false;
      this.prevCycleIndex = null;
      for (const m of this.meshes.cycle) {
        if (m.material.opacity !== 0) m.material.opacity = 0;
      }
    }
  }

  /**
   * Amplitude mode during active speech: pick the cycle frame from the eased
   * openness (`Mouth_00` = temporary closed lips without smile lines .. last =
   * open "A"). Never reverts to `silentClosed` (base photo) during short word
   * pauses, preventing cheek smile-line flicker mid-sentence.
   */
  private tickAmplitude(dt: number): void {
    const ease = 1 - Math.exp(-dt / OPENNESS_EASE_TAU_S);
    this.openness += (this.opennessTarget - this.openness) * ease;

    const lastIndex = this.meshes.cycle.length - 1;
    const idx = Math.max(0, Math.min(lastIndex, Math.round(this.openness * lastIndex)));

    this.amplitudeHoldElapsed += dt;
    let frameAdvanced = false;
    if (idx !== this.cycleIndex && this.amplitudeHoldElapsed >= this.minFrameTime) {
      this.prevCycleIndex = this.cycleIndex;
      this.cycleIndex = idx;
      this.amplitudeHoldElapsed = 0;
      frameAdvanced = true;
    }

    // Fade out `silentClosed` cleanly at utterance start (it sits above cycle
    // at zSilent), keeping it strictly at 0 for the rest of the utterance.
    const sc = this.meshes.silentClosed.material;
    if (sc.opacity > 0) {
      const nextSc = sc.opacity - dt * Math.max(this.fadeInRate, 28);
      sc.opacity = nextSc < 0.08 ? 0 : nextSc;
    }
    this.meshes.silentOpen.material.opacity = 0;

    this.crossFadeToCurrent(dt, frameAdvanced);
  }

  private tickSpeaking(dt: number): void {
    this.frameElapsed += dt;
    let frameAdvanced = false;
    if (this.frameElapsed >= this.frameTime) {
      this.frameElapsed = 0;
      this.prevCycleIndex = this.cycleIndex;
      this.cycleIndex += this.cycleDirection;
      if (this.cycleIndex >= this.meshes.cycle.length - 1) {
        this.cycleDirection = -1;
      } else if (this.cycleIndex <= 0) {
        this.cycleDirection = 1;
      }
      frameAdvanced = true;
    }
    this.meshes.silentClosed.material.opacity = 0;
    this.meshes.silentOpen.material.opacity = 0;
    this.crossFadeToCurrent(dt, frameAdvanced);
  }

  /**
   * Crisp anti-ghosting transition to `cycleIndex`:
   *   1. On frame change, hard-zero every sprite except the incoming frame and
   *      the single immediate previous frame (strictly <= 2 active sprites).
   *   2. Ramp the incoming frame rapidly on top (`renderOrder = 100`) at
   *      `fadeInRate` (~31ms at 32/s).
   *   3. The instant the incoming frame reaches >= 0.92, snap it to 1 and
   *      IMMEDIATELY zero the previous frame (eliminating trailing double-lip
   *      ghosting underneath).
   */
  private crossFadeToCurrent(dt: number, frameAdvanced: boolean): void {
    if (frameAdvanced) {
      for (let i = 0; i < this.meshes.cycle.length; i++) {
        if (i === this.cycleIndex) {
          this.meshes.cycle[i].renderOrder = 100;
        } else if (i === this.prevCycleIndex) {
          this.meshes.cycle[i].renderOrder = 50;
          this.meshes.cycle[i].material.opacity = 1;
        } else {
          this.meshes.cycle[i].renderOrder = 0;
          this.meshes.cycle[i].material.opacity = 0;
        }
      }
    }

    const currentMat = this.meshes.cycle[this.cycleIndex].material;
    if (currentMat.opacity < 1) {
      currentMat.opacity = Math.min(
        1,
        currentMat.opacity + dt * this.fadeInRate,
      );
      if (currentMat.opacity >= 0.92) {
        currentMat.opacity = 1;
        this.prevCycleIndex = null;
        for (let i = 0; i < this.meshes.cycle.length; i++) {
          if (i !== this.cycleIndex) {
            this.meshes.cycle[i].material.opacity = 0;
            this.meshes.cycle[i].renderOrder = 0;
          }
        }
      }
    } else if (this.prevCycleIndex !== null) {
      this.prevCycleIndex = null;
      for (let i = 0; i < this.meshes.cycle.length; i++) {
        if (i !== this.cycleIndex) {
          this.meshes.cycle[i].material.opacity = 0;
          this.meshes.cycle[i].renderOrder = 0;
        }
      }
    }
  }

  private tickBriefSilence(dt: number): void {
    this.briefSilenceElapsed += dt;
    // End-of-utterance close-out: fade cycle sprites + silentOpen out, fade
    // silentClosed in. Earlier versions held silentOpen visible to avoid the
    // mouth snapping shut between utterances, but that sprite is a wide-open
    // "A" shape and showed as a phantom vowel at sentence ends. Unity closes
    // straight back to the closed-mouth sprite instead.
    this.fadeMaterial(this.meshes.silentOpen.material, 0, dt, this.fadeOutRate);
    // Slow-close: ease the closed mouth in over ~0.3 s rather than snapping
    // (faster for characters with a mouthless backdrop - see silentCloseRate).
    this.fadeMaterial(this.meshes.silentClosed.material, 1, dt, this.silentCloseRate);
    for (const m of this.meshes.cycle) {
      this.fadeMaterial(m.material, 0, dt, this.fadeOutRate);
    }
    if (this.briefSilenceElapsed >= BRIEF_SILENCE_MAX_S && !this.speaking) {
      this.phase = "silent";
    }
  }

  private tickSilent(dt: number): void {
    const closeRate = this.fastClosing ? 18 : this.silentCloseRate;
    const outRate = this.fastClosing ? 24 : this.fadeOutRate;
    this.fadeMaterial(this.meshes.silentClosed.material, 1, dt, closeRate);
    this.fadeMaterial(this.meshes.silentOpen.material, 0, dt, outRate);
    for (const m of this.meshes.cycle) {
      this.fadeMaterial(m.material, 0, dt, outRate);
    }
    if (this.meshes.silentClosed.material.opacity >= 0.999) {
      this.fastClosing = false;
    }
  }

  private fadeMaterial(
    mat: THREE.MeshBasicMaterial,
    target: number,
    dt: number,
    rate: number,
  ): void {
    const diff = target - mat.opacity;
    if (Math.abs(diff) < 0.001) {
      mat.opacity = target;
      return;
    }
    const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    let next = Math.max(0, Math.min(1, mat.opacity + step));
    // Snap to 0 when fading out and close enough - avoids long invisible
    // tails (matches Unity `if (alpha < 0.1f) alpha = 0f`).
    if (target === 0 && next < FADE_OUT_SNAP) next = 0;
    mat.opacity = next;
  }

  private applyInitialAlpha(): void {
    this.meshes.silentClosed.material.opacity = 1;
    this.meshes.silentOpen.material.opacity = 0;
    if (this.singleAmplitudePose) this.meshes.silentOpen.visible = false;
    for (const mesh of this.meshes.cycle) {
      mesh.material.opacity = 0;
      if (this.singleAmplitudePose) mesh.visible = false;
    }
  }
}
