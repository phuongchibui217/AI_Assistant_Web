import * as THREE from "three";

/**
 * Slow whole-body sway. The client's WebGL demo gently rocks the avatar side to
 * side; our port only had breathing + head tilt and read as static (client
 * 2026-06-26). This drifts the whole figure (body + neck + head together) on a
 * slow sine with a small coupled lean, so it sways rather than slides on ice.
 *
 * Applied to the group that wraps the entire avatar, so every layer moves as one
 * - independent of the breathing scale (also on this group) and the per-part
 * animators (head tilt, gaze, mouth) below it.
 */

const PERIOD_S = 8.7; // one full left-right-left cycle (~0.75x earlier speed)
const AMP_X = 11; // horizontal swing, layout px (eased down a touch)
const LEAN_DEG = 0.6; // lean into the swing
const SPEAKING_GAIN = 1.25; // a touch livelier while speaking

export class BodySwayAnimator {
  private readonly group: THREE.Group;
  private elapsed = 0;
  private speaking = false;

  constructor(group: THREE.Group) {
    this.group = group;
  }

  setSpeaking(isSpeaking: boolean): void {
    this.speaking = isSpeaking;
  }

  update(dt: number): void {
    this.elapsed += dt;
    const s = Math.sin((this.elapsed / PERIOD_S) * Math.PI * 2);
    const gain = this.speaking ? SPEAKING_GAIN : 1;
    this.group.position.x = s * AMP_X * gain;
    this.group.rotation.z = THREE.MathUtils.degToRad(s * LEAN_DEG * gain);
  }
}
