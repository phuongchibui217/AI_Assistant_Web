import * as THREE from "three";

/**
 * Idle head sway. Ports Unity `AIAvatarManagerSP.UpdateHed()`.
 *
 * The head slowly tilts a degree or so to one side, eases back to centre,
 * dwells, then picks the other side - a small Z-rotation oscillation that
 * keeps the avatar from looking frozen. Driven as a 5-state machine on the
 * tilt angle (`rot`, in degrees):
 *
 *   0  centre  - wait `waitMax` seconds, then randomly head to a side
 *   1  centre -> right (+)   until `+maxValue`
 *  -1  right  -> centre      then dwell (idle) or chain to left (speaking)
 *   2  centre -> left  (-)   until `-maxValue`
 *  -2  left   -> centre      then dwell
 *
 * Unity hard-codes the on-voice "freeze at centre" branch off, so speaking
 * only changes the tuning (faster but smaller range, longer dwell), never the
 * transitions. Parity #33.
 */

// Degrees and seconds. Amplitudes raised well above the Unity defaults
// (was 0.8/1.3 deg) to match the client's WebGL build, whose head motion is
// slow but clearly visible - our subtle port read as frozen (client 2026-06-26).
// Speed raised in step so the larger tilt still completes in ~5s, not ~12s.
const SPEED_VOICE_ON = 0.6;
const SPEED_VOICE_OFF = 0.45;
const WAIT_MAX_VOICE_ON = 2;
const WAIT_MAX_VOICE_OFF = 0.4;
// Shrunk from 2.5/3.5 (2026-07-30): the head's own tilt is additive on top of
// body-sway's rotation but runs on an independent random L/R cycle, so at
// full amplitude it could momentarily lean opposite to the body's lean and
// read as the neck twisting out of sync (client feedback).
const MAXVALUE_VOICE_ON = 1.1;
const MAXVALUE_VOICE_OFF = 1.5;

type LRState = 0 | 1 | -1 | 2 | -2;

export class HeadSwayAnimator {
  private readonly headGroup: THREE.Group;
  private readonly amplitudeScale: number;

  private rot = 0; // current tilt in degrees
  private lr: LRState = 0;
  private waitTime = 0;
  private speaking = false;

  constructor(headGroup: THREE.Group, amplitudeScale = 1) {
    this.headGroup = headGroup;
    this.amplitudeScale = amplitudeScale;
  }

  setSpeaking(isSpeaking: boolean): void {
    this.speaking = isSpeaking;
  }

  update(dt: number): void {
    const speed = (this.speaking ? SPEED_VOICE_ON : SPEED_VOICE_OFF) * this.amplitudeScale;
    const waitMax = this.speaking ? WAIT_MAX_VOICE_ON : WAIT_MAX_VOICE_OFF;
    const maxValue = (this.speaking ? MAXVALUE_VOICE_ON : MAXVALUE_VOICE_OFF) * this.amplitudeScale;

    switch (this.lr) {
      case 0: // centre - dwell, then pick a side
        this.waitTime += dt;
        if (this.waitTime > waitMax) {
          this.waitTime = 0;
          this.lr = Math.random() < 0.5 ? 1 : 2;
        }
        break;
      case 1: // centre -> right
        this.rot += dt * speed;
        if (this.rot > maxValue) this.lr = -1;
        break;
      case -1: // right -> centre
        this.rot -= dt * speed;
        if (this.rot < 0) {
          this.rot = 0;
          // While speaking, swing straight to the other side; otherwise rest.
          this.lr = this.speaking ? 2 : 0;
        }
        break;
      case 2: // centre -> left
        this.rot -= dt * speed;
        if (this.rot < -maxValue) this.lr = -2;
        break;
      case -2: // left -> centre
        this.rot += dt * speed;
        if (this.rot > 0) {
          this.rot = 0;
          this.lr = 0;
        }
        break;
    }

    this.headGroup.rotation.z = THREE.MathUtils.degToRad(this.rot);
  }
}
