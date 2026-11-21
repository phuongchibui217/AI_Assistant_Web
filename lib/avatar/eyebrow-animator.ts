import * as THREE from "three";

/**
 * Eyebrow vertical-bob animator. Ports Unity `AIAvatarManagerSP.UpdateEyebrow()`.
 *
 * Eyebrows have three "actions":
 *  - raiseSmall (+2 px, fast): mid-conversation voice start
 *  - raiseLarge (+4 px): voice start from standby
 *  - lowerSmall (-1 px, fast): tied to blink
 *
 * Each action moves to the target, holds briefly, then returns to neutral.
 */

type EyebrowMeshes = {
  left: THREE.Object3D;
  right: THREE.Object3D;
};

type Action = "raiseSmall" | "raiseLarge" | "lowerSmall";

const ACTION_DETAILS: Record<Action, { offset: number; speed: number }> = {
  raiseSmall: { offset: 2, speed: 0.05 * 60 },
  raiseLarge: { offset: 4, speed: 0.1 * 60 },
  lowerSmall: { offset: -1, speed: 0.1 * 60 },
};

type Phase = "outgoing" | "returning" | "idle";

export class EyebrowAnimator {
  private readonly meshes: EyebrowMeshes;
  private readonly baseY: { left: number; right: number };
  private targetOffset = 0;
  private speed = 0;
  private phase: Phase = "idle";

  constructor(meshes: EyebrowMeshes) {
    this.meshes = meshes;
    this.baseY = {
      left: meshes.left.position.y,
      right: meshes.right.position.y,
    };
  }

  trigger(action: Action): void {
    if (this.phase !== "idle") return;
    const { offset, speed } = ACTION_DETAILS[action];
    this.targetOffset = offset;
    this.speed = speed;
    this.phase = "outgoing";
  }

  update(dt: number): void {
    if (this.phase === "idle") return;

    if (this.phase === "outgoing") {
      this.lerpToOffset(this.targetOffset, dt);
      if (this.isAtOffset(this.targetOffset)) {
        this.phase = "returning";
      }
    } else if (this.phase === "returning") {
      this.lerpToOffset(0, dt);
      if (this.isAtOffset(0)) {
        this.phase = "idle";
      }
    }
  }

  private lerpToOffset(target: number, dt: number): void {
    const stepPx = this.speed * dt;
    for (const side of ["left", "right"] as const) {
      const base = this.baseY[side];
      const current = this.meshes[side].position.y - base;
      const diff = target - current;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), stepPx);
      this.meshes[side].position.y = base + current + step;
    }
  }

  private isAtOffset(target: number): boolean {
    const leftDelta = this.meshes.left.position.y - this.baseY.left;
    const rightDelta = this.meshes.right.position.y - this.baseY.right;
    const tolerance = 0.05;
    return (
      Math.abs(leftDelta - target) < tolerance &&
      Math.abs(rightDelta - target) < tolerance
    );
  }
}
