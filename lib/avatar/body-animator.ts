import * as THREE from "three";

/**
 * Body breathing + arm gesture animator.
 *
 * Ports Unity `AIAvatarManagerSP.UpdateBody()` + `UpdateArm()`:
 * - Breathing: body group scales between 1.0 and `breathPeakScale`. Cycle
 *   waits `IDLE_WAIT_S` (or `SPEAKING_WAIT_S`) at the bottom before the next
 *   inhale.
 * - Arm gestures: spread outward on talk start, pull back on talk end.
 *
 * The breathing scale targets `breathGroup`; gestures target `armLeftGroup` /
 * `armRightGroup` so the rest of the body keeps breathing independently.
 */

const IDLE_WAIT_S = 1.5;
const SPEAKING_WAIT_S = 1.0;
// Breathing amplitudes raised far above the Unity defaults (peak was 1.003 =
// 0.3%, basically invisible) and the rate slowed so the chest visibly swells
// over ~2s instead of a 0.025s pop - the client's WebGL build breathes slowly
// but noticeably and our port read as frozen (client 2026-06-26).
const BREATH_RATE = 0.006; // scale units/sec: ~2.5s to swell 1.5% (~0.75x speed)
const IDLE_PEAK_SCALE = 1.015;
const SPEAKING_PEAK_SCALE = 1.012;
// Talk-start "action" breath: one deeper inhale so the avatar visibly draws
// breath as it starts to speak, then settles back to the normal breathing
// cycle (parity #28). Kept deeper than the (now larger) idle breath.
const ACTION_PEAK_SCALE = 1.025;
const ACTION_BREATH_RATE = 0.003; // ~8s full swell, a slow deliberate breath

type BreathPhase = "inhale" | "exhale" | "rest";

type ArmGestureTarget = {
  group: THREE.Group;
  /** Anchor offset relative to default position. */
  offset: THREE.Vector3;
};

const ARM_LERP_PER_SEC = 2.5;

type GestureState = "none" | "talkStart" | "talkEnd";

export class BodyAnimator {
  private readonly breathGroup: THREE.Group;
  private readonly armLeft: ArmGestureTarget;
  private readonly armRight: ArmGestureTarget;

  private breathPhase: BreathPhase = "rest";
  private breathElapsed = 0;
  private speaking = false;
  /** One-shot deeper breath cycle kicked off by onTalkStart. */
  private breathAction = false;

  private gesture: GestureState = "none";

  constructor(
    breathGroup: THREE.Group,
    armLeftGroup: THREE.Group,
    armRightGroup: THREE.Group,
  ) {
    this.breathGroup = breathGroup;
    this.armLeft = { group: armLeftGroup, offset: new THREE.Vector3(0, 0, 0) };
    this.armRight = { group: armRightGroup, offset: new THREE.Vector3(0, 0, 0) };
  }

  setSpeaking(isSpeaking: boolean): void {
    this.speaking = isSpeaking;
  }

  onTalkStart(): void {
    this.gesture = "talkStart";
    this.armLeft.offset.set(-4, 12, 0);
    this.armRight.offset.set(4, 12, 0);
    // Kick a deeper breath right now, regardless of where the idle cycle was.
    this.breathAction = true;
    this.breathPhase = "inhale";
    this.breathElapsed = 0;
  }

  onTalkEnd(): void {
    this.gesture = "talkEnd";
    this.armLeft.offset.set(-4, -4, 0);
    this.armRight.offset.set(4, -4, 0);
  }

  /** Return arms to neutral position. Called automatically a few seconds after gesture. */
  resetGesture(): void {
    this.gesture = "none";
    this.armLeft.offset.set(0, 0, 0);
    this.armRight.offset.set(0, 0, 0);
  }

  update(dt: number): void {
    this.tickBreath(dt);
    this.tickArms(dt);
  }

  private tickBreath(dt: number): void {
    const peak = this.breathAction
      ? ACTION_PEAK_SCALE
      : this.speaking
        ? SPEAKING_PEAK_SCALE
        : IDLE_PEAK_SCALE;
    const rate = this.breathAction ? ACTION_BREATH_RATE : BREATH_RATE;
    const wait = this.speaking ? SPEAKING_WAIT_S : IDLE_WAIT_S;

    if (this.breathPhase === "inhale") {
      const current = this.breathGroup.scale.x;
      const next = Math.min(peak, current + rate * dt);
      this.breathGroup.scale.setScalar(next);
      if (next >= peak) {
        this.breathPhase = "exhale";
      }
    } else if (this.breathPhase === "exhale") {
      const current = this.breathGroup.scale.x;
      const next = Math.max(1, current - rate * dt);
      this.breathGroup.scale.setScalar(next);
      if (next <= 1) {
        this.breathPhase = "rest";
        this.breathElapsed = 0;
        // The deeper talk-start breath is one-shot; resume normal breathing.
        this.breathAction = false;
      }
    } else {
      this.breathElapsed += dt;
      if (this.breathElapsed >= wait) {
        this.breathPhase = "inhale";
      }
    }
  }

  private tickArms(dt: number): void {
    const k = Math.min(1, ARM_LERP_PER_SEC * dt);
    this.lerpArm(this.armLeft, k);
    this.lerpArm(this.armRight, k);
  }

  private lerpArm(target: ArmGestureTarget, k: number): void {
    target.group.position.lerp(target.offset, k);
  }
}
