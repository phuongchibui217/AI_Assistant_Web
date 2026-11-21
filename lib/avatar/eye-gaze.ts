import * as THREE from "three";

/**
 * Random eye-gaze animator. Ports Unity `AIAvatarManagerSP.UpdateEyeball()`,
 * reworked to a fixate/saccade model so idle gaze reads naturally.
 *
 * Real eyes hold still (fixate) most of the time, then jump quickly (saccade)
 * to a new point and hold again - they do NOT drift continuously. The earlier
 * version retargeted every 1.5s and lerp'd toward the moving target every frame,
 * so the irises never settled and looked like they were "swimming" while idle
 * (client feedback 2026-06-26: 富士崎玲奈 待機時の目が不自然). Now the iris
 * snaps to a target over ~90ms, then holds for a random dwell before the next
 * glance, with most glances small + near forward so the avatar mostly looks at
 * the user.
 *
 * The `anchor` constructor argument is the eyeballGroup's neutral world position
 * (head centre); all gaze offsets are added on top so we never lose the
 * underlying placement.
 *
 * When blinking, the irises are snapped to their anchor and locked there - the
 * eyelid covers them so movement during a blink would be invisible anyway.
 */

// The gaze alternates between resting AT CENTRE (eye contact with the user) and
// a brief glance away. It rests forward most of the time and only occasionally
// darts off and comes straight back, so the avatar mostly looks at the user
// instead of wandering point-to-point (client feedback 2026-07-19).
const CENTRE_DWELL_MIN_S = 3.0;
const CENTRE_DWELL_MAX_S = 7.0;
const GLANCE_DWELL_MIN_S = 0.6;
const GLANCE_DWELL_MAX_S = 1.6;
const SACCADE_DURATION_S = 0.09;
// Most glances are small settles near forward; a minority are a wider look.
const SMALL_GLANCE_PROB = 0.65;
const SMALL_GLANCE_SCALE = 0.35;

type Phase = "fixate" | "saccade";
type GazeAmplitude = { ampX: number; ampY: number };

export class EyeGazeAnimator {
  private readonly eyeballGroup: THREE.Group;
  private readonly anchor: THREE.Vector3;
  private readonly amp: GazeAmplitude;
  private readonly target = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private phase: Phase = "fixate";
  private dwell: number;
  private saccadeElapsed = 0;
  /** True while the irises rest at centre (looking at the user); false during
   *  the brief glance away. Drives the alternating dwell + target. */
  private atCentre = true;
  private locked = false;
  /** Locked to centre while the avatar is speaking (eye contact with the user).
   *  Kept separate from `locked` (blink) so a blink ending mid-utterance does
   *  not resume idle wandering. */
  private speakingLocked = false;

  constructor(
    eyeballGroup: THREE.Group,
    anchor: THREE.Vector3,
    amp: GazeAmplitude,
  ) {
    this.eyeballGroup = eyeballGroup;
    this.anchor = anchor.clone();
    this.amp = amp;
    this.eyeballGroup.position.copy(this.anchor);
    this.target.copy(this.anchor);
    this.dwell = randRange(CENTRE_DWELL_MIN_S, CENTRE_DWELL_MAX_S);
  }

  /** Dwell length for the next fixate: long when resting at centre, short when
   *  glanced away (so the eye springs back to the user quickly). */
  private nextDwell(): number {
    return this.atCentre
      ? randRange(CENTRE_DWELL_MIN_S, CENTRE_DWELL_MAX_S)
      : randRange(GLANCE_DWELL_MIN_S, GLANCE_DWELL_MAX_S);
  }

  /** Called on blink-start to freeze the irises where they are during the blink.
   *  We hold the current gaze instead of snapping to centre: the lid fully
   *  covers the eye, and snapping back read as an unwanted reset each blink
   *  (client feedback 2026-07-19). */
  lockGaze(): void {
    this.locked = true;
  }

  /** Called on blink-end to resume gaze: hold at centre, then glance again. */
  unlock(): void {
    this.locked = false;
    this.phase = "fixate";
    this.dwell = this.nextDwell();
  }

  /**
   * Lock the irises forward (eye contact) while speaking; resume idle glancing
   * when idle. Free eye wandering should only happen when the model is idle.
   */
  setSpeaking(speaking: boolean): void {
    this.speakingLocked = speaking;
    this.phase = "fixate";
    this.atCentre = true;
    if (speaking) {
      this.eyeballGroup.position.copy(this.anchor);
      this.target.copy(this.anchor);
    } else {
      this.dwell = randRange(CENTRE_DWELL_MIN_S, CENTRE_DWELL_MAX_S);
    }
  }

  update(dt: number): void {
    if (this.locked || this.speakingLocked) return;

    if (this.phase === "fixate") {
      this.dwell -= dt;
      if (this.dwell <= 0) {
        this.from.copy(this.eyeballGroup.position);
        if (this.atCentre) {
          // Was resting on the user: dart off to a nearby point.
          this.pickNewTarget();
          this.atCentre = false;
        } else {
          // Was glancing away: spring back to the user.
          this.target.copy(this.anchor);
          this.atCentre = true;
        }
        this.saccadeElapsed = 0;
        this.phase = "saccade";
      }
      return;
    }

    // Saccade: quick ease-out jump to the new target, then hold.
    this.saccadeElapsed += dt;
    const t = Math.min(1, this.saccadeElapsed / SACCADE_DURATION_S);
    const eased = 1 - Math.pow(1 - t, 3);
    this.eyeballGroup.position.lerpVectors(this.from, this.target, eased);
    if (t >= 1) {
      this.phase = "fixate";
      this.dwell = this.nextDwell();
    }
  }

  private pickNewTarget(): void {
    const scale =
      Math.random() < SMALL_GLANCE_PROB ? SMALL_GLANCE_SCALE : 1;
    // Symmetric range so glances go up/down/left/right, not just down.
    const x = this.anchor.x + randRange(-this.amp.ampX, this.amp.ampX) * scale;
    const y = this.anchor.y + randRange(-this.amp.ampY, this.amp.ampY) * scale;
    this.target.set(x, y, this.anchor.z);
  }
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
