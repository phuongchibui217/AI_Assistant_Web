import * as THREE from "three";

/**
 * Eye blink animator. Ports Unity `AIAvatarManagerSP.UpdateMepati()`:
 *
 * - Wait `IDLE_INTERVAL_S` (or `SPEAKING_INTERVAL_S` while voice is on) then
 *   roll a probability gate. On pass, play the blink.
 * - Frames swap instantly (no alpha fade between blink frames - Unity
 *   parity).
 * - Idle eye visibility is restored after the blink completes.
 * - During blink, the eyeball sprites AND the eye-background trio
 *   (eye base, white, white-shadow) are hidden so the eyelid sprite has
 *   nothing to peek around - UNLESS `keepEyeBg` is set (male), whose lid
 *   frames sit on the top avatar layer and fully cover the closed eye, so the
 *   live eye can stay visible under the near-open frames instead of exposing
 *   the baked-open face eye (client feedback 2026-07-19).
 *
 * Two playback modes:
 * - 4-slot (female): plays openToClose -> close -> closeToOpen, 3 frames.
 * - Ordered sequence (male, `meshes.sequence`): plays the full lid descent
 *   forward then reverses it (e.g. 1->2->3->4->5->4->3->2->1) so the eyelid
 *   closes smoothly instead of jumping open -> half -> closed in two big steps.
 *
 * Two callback hooks allow other animators (eyebrow, gaze) to sync with
 * the blink start/end.
 */

type LidMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

type BlinkMeshes = {
  /** 4 frames in order: openToClose, close, closeToOpen, half (rest). */
  open: LidMesh;
  openToClose: LidMesh;
  close: LidMesh;
  closeToOpen: LidMesh;
  /**
   * Optional ordered lid frames from just-past-open to fully closed. When set,
   * the animator uses the smooth-descent playback instead of the 4-slot swap.
   */
  sequence?: LidMesh[];
  /** Everything that visually IS the open eye and must be hidden while a
   *  blink plays: eyeball group + the three eye-background sprites. The
   *  blink frame textures only cover the eyelid arc, not the wider eye
   *  white area, so leaving the bg trio visible used to show a "second
   *  pair of eyes" through the closed lid. */
  eyeBgLayers: THREE.Object3D[];
  /** When true, do NOT hide `eyeBgLayers` during a blink. Used by the male,
   *  whose lid sits on the top layer and covers the closed eye fully - keeping
   *  the live eye visible under the near-open frames looks natural, whereas
   *  hiding it would expose the baked-open eye painted into the face. */
  keepEyeBg?: boolean;
};

type BlinkCallbacks = {
  onBlinkStart?: () => void;
  onBlinkEnd?: () => void;
};

const IDLE_INTERVAL_S = 3.5;
const SPEAKING_INTERVAL_S = 6.0;
const BLINK_PROBABILITY = 0.7;
const DOUBLE_BLINK_PROBABILITY = 0.2;
const SLOW_MODE_PROBABILITY = 0.2;
const FRAME_TIME_FAST_S = 0.04;
const FRAME_TIME_SLOW_S = 0.06;
const CLOSED_HOLD_S = 0.2;

type State =
  | { kind: "idle"; elapsed: number; interval: number }
  | { kind: "playing"; frame: number; frameElapsed: number; slow: boolean; queueSecond: boolean };

export class BlinkAnimator {
  private readonly meshes: BlinkMeshes;
  private readonly callbacks: BlinkCallbacks;
  private speaking = false;
  private state: State;

  /** All lid meshes (4-slot + sequence) for blanket hide. */
  private readonly allLids: LidMesh[];
  /**
   * Sequence playback order (indices into meshes.sequence): forward to the
   * closed peak, then back to the first frame. Empty when no sequence is set,
   * in which case the 4-slot machine drives the blink.
   */
  private readonly playOrder: number[];

  constructor(meshes: BlinkMeshes, callbacks: BlinkCallbacks = {}) {
    this.meshes = meshes;
    this.callbacks = callbacks;
    this.state = { kind: "idle", elapsed: 0, interval: IDLE_INTERVAL_S };
    this.allLids = [
      meshes.open,
      meshes.openToClose,
      meshes.close,
      meshes.closeToOpen,
      ...(meshes.sequence ?? []),
    ];
    const seq = meshes.sequence;
    if (seq && seq.length >= 2) {
      // forward 0..last, then back last-1..0 (last = fully closed peak).
      const order: number[] = [];
      for (let i = 0; i < seq.length; i++) order.push(i);
      for (let i = seq.length - 2; i >= 0; i--) order.push(i);
      this.playOrder = order;
    } else {
      this.playOrder = [];
    }
    // Rest state shows NO lid frame: the gaze eye stack (base/white/eyeball)
    // underneath IS the open eye, so the eyeball can move. Showing the
    // `Eye_Open` frame here would paint a static open eye (with its baked-in
    // tan matte halo) on top, hiding the gaze and adding a visible seam.
    this.hideAllLids();
    this.setEyeBgVisible(true);
  }

  private get usesSequence(): boolean {
    return this.playOrder.length > 0;
  }

  setSpeaking(isSpeaking: boolean): void {
    this.speaking = isSpeaking;
    if (this.state.kind === "idle") {
      this.state.interval = isSpeaking ? SPEAKING_INTERVAL_S : IDLE_INTERVAL_S;
    }
  }

  /** Force a blink immediately (e.g. user-triggered or test). */
  triggerBlink(): void {
    if (this.state.kind !== "idle") return;
    this.startBlink(false, Math.random() < DOUBLE_BLINK_PROBABILITY);
  }

  update(dt: number): void {
    if (this.state.kind === "idle") {
      this.state.elapsed += dt;
      if (this.state.elapsed < this.state.interval) return;
      this.state.elapsed = 0;
      if (Math.random() < BLINK_PROBABILITY) {
        const slow = Math.random() < SLOW_MODE_PROBABILITY;
        const queueSecond = Math.random() < DOUBLE_BLINK_PROBABILITY;
        this.startBlink(slow, queueSecond);
      }
      return;
    }

    // Playing
    this.state.frameElapsed += dt;
    const frameTime = this.state.slow ? FRAME_TIME_SLOW_S : FRAME_TIME_FAST_S;
    const thisFrameTime = this.isClosedPeak(this.state.frame) && this.state.slow
      ? CLOSED_HOLD_S
      : frameTime;
    if (this.state.frameElapsed < thisFrameTime) return;

    this.state.frameElapsed = 0;
    this.state.frame += 1;

    if (this.isFinished(this.state.frame)) {
      // Blink finished: hide every lid frame and reveal the gaze eye stack -
      // that stack is the resting open eye, no `Eye_Open` frame needed.
      this.hideAllLids();
      this.setEyeBgVisible(true);
      this.callbacks.onBlinkEnd?.();
      if (this.state.queueSecond) {
        this.startBlink(false, false);
      } else {
        this.state = {
          kind: "idle",
          elapsed: 0,
          interval: this.speaking ? SPEAKING_INTERVAL_S : IDLE_INTERVAL_S,
        };
      }
      return;
    }

    this.showBlinkFrame(this.state.frame);
  }

  /** Begin a blink: hide the eye stack (unless keepEyeBg) and play frame 0. */
  private startBlink(slow: boolean, queueSecond: boolean): void {
    this.state = {
      kind: "playing",
      frame: 0,
      frameElapsed: 0,
      slow,
      queueSecond,
    };
    if (!this.meshes.keepEyeBg) this.setEyeBgVisible(false);
    this.showBlinkFrame(0);
    this.callbacks.onBlinkStart?.();
  }

  /** True once `frame` has advanced past the last motion frame. */
  private isFinished(frame: number): boolean {
    return this.usesSequence ? frame >= this.playOrder.length : frame > 2;
  }

  /** True when the given motion frame is the fully-closed peak. */
  private isClosedPeak(frame: number): boolean {
    if (this.usesSequence) {
      return this.playOrder[frame] === (this.meshes.sequence!.length - 1);
    }
    // 4-slot: `close` is frame 1.
    return frame === 1;
  }

  private showBlinkFrame(frame: number): void {
    if (this.usesSequence) {
      const seq = this.meshes.sequence!;
      this.showOnly(seq[this.playOrder[frame]]);
      return;
    }
    switch (frame) {
      case 0:
        this.showOnly(this.meshes.openToClose);
        return;
      case 1:
        this.showOnly(this.meshes.close);
        return;
      default:
        this.showOnly(this.meshes.closeToOpen);
    }
  }

  private setEyeBgVisible(v: boolean): void {
    for (const o of this.meshes.eyeBgLayers) o.visible = v;
  }

  /** Hide all lid frames so the gaze eye stack underneath shows (rest state). */
  private hideAllLids(): void {
    for (const m of this.allLids) m.material.opacity = 0;
  }

  private showOnly(target: LidMesh): void {
    for (const m of this.allLids) {
      m.material.opacity = m === target ? 1 : 0;
    }
  }
}
