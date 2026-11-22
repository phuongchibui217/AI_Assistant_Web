import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { FEMALE, MALE } from "./characters";
import { LipSyncDriver } from "./lip-sync";
import { MouthAnimator, type MouthFadeTuning } from "./mouth-animator";
import { makeMouthFeather } from "./renderer";

function makeFakeMesh() {
  return {
    material: { opacity: 0 },
    renderOrder: 0,
    visible: true,
  } as unknown as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

function createHarness(tuning?: MouthFadeTuning, poseCount = 6) {
  const cycle = Array.from({ length: poseCount }, () => makeFakeMesh());
  const silentClosed = makeFakeMesh();
  const silentOpen = makeFakeMesh();
  const animator = new MouthAnimator(
    { cycle, silentClosed, silentOpen },
    tuning ?? {
      mode: "amplitude",
      fadeInRate: 32,
      fadeOutRate: 40,
      minFrameTime: 0.075,
      silentCloseRate: 24,
    },
  );
  return { animator, cycle, silentClosed, silentOpen };
}

describe("MouthAnimator (amplitude mode lip-sync)", () => {
  it("1. Idle shows ONLY silentClosed (100% original base) and zero cycle frames", () => {
    const { animator, cycle, silentClosed, silentOpen } = createHarness();
    for (let i = 0; i < 60; i++) animator.update(1 / 60);

    expect(silentClosed.material.opacity).toBe(1);
    expect(silentOpen.material.opacity).toBe(0);
    expect(cycle.every((m) => m.material.opacity === 0)).toBe(true);
  });

  it("2. Starting speech smoothly fades out silentClosed and enters speaking cycle", () => {
    const { animator, cycle, silentClosed } = createHarness();
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(0.6);

    for (let i = 0; i < 6; i++) animator.update(1 / 60); // ~100ms
    expect(silentClosed.material.opacity).toBe(0);
    expect(cycle.some((m) => m.material.opacity === 1)).toBe(true);
  });

  it("3. Short pause between two words uses Mouth_00 (cycle[0]) and NEVER flashes silentClosed", () => {
    const { animator, cycle, silentClosed } = createHarness();
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(0.8);
    for (let i = 0; i < 10; i++) animator.update(1 / 60);

    // Dip openness to 0 for a brief inter-word / comma pause while still speaking
    animator.setSyntheticOpenness(0);
    for (let i = 0; i < 15; i++) {
      animator.update(1 / 60);
      // Base smile (silentClosed) must stay strictly hidden throughout the utterance
      expect(silentClosed.material.opacity).toBe(0);
    }
    expect(cycle[0].material.opacity).toBe(1);
    expect(cycle.slice(1).every((m) => m.material.opacity === 0)).toBe(true);
  });

  it("4. Continuous speech exercises all 6 shapes without ghosting (<=2 sprites mid-swap, 1 settled)", () => {
    const { animator, cycle, silentClosed } = createHarness();
    animator.setSyntheticSpeaking(true);

    const targets = [0.2, 0.4, 0.6, 0.8, 1.0, 0.0, 0.6, 1.0];
    const visited = new Set<number>();

    for (const target of targets) {
      animator.setSyntheticOpenness(target);
      for (let tick = 0; tick < 12; tick++) {
        animator.update(1 / 60);
        const nonZero = cycle.filter((m) => m.material.opacity > 0).length;
        // Strict anti-ghosting invariant: never > 2 sprites non-zero simultaneously
        expect(nonZero).toBeLessThanOrEqual(2);
      }
      // Once settled on target openness, strictly 1 sprite is opaque and all others are 0
      const activeIndices = cycle
        .map((m, idx) => (m.material.opacity > 0 ? idx : -1))
        .filter((idx) => idx >= 0);
      expect(activeIndices.length).toBe(1);
      expect(cycle[activeIndices[0]].material.opacity).toBe(1);
      expect(silentClosed.material.opacity).toBe(0);
      visited.add(activeIndices[0]);
    }

    // All 6 shapes (0..5) must have been cleanly visited
    expect([...visited].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("5. Ending sentence smoothly returns to silentClosed (original base) and zeroes all cycle sprites", () => {
    const { animator, cycle, silentClosed } = createHarness();
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(1.0);
    for (let i = 0; i < 10; i++) animator.update(1 / 60);

    animator.setSyntheticSpeaking(false);
    for (let i = 0; i < 10; i++) animator.update(1 / 60); // ~166ms

    expect(silentClosed.material.opacity).toBe(1);
    expect(cycle.every((m) => m.material.opacity === 0)).toBe(true);
  });

  it("6. Consecutive sentences back-to-back leave zero stuck opacities or overlapping states", () => {
    const { animator, cycle, silentClosed } = createHarness();

    // Sentence 1
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(0.9);
    for (let i = 0; i < 10; i++) animator.update(1 / 60);
    animator.setSyntheticSpeaking(false);
    // Interrupt mid-close (after just 1 tick) with Sentence 2!
    animator.update(1 / 60);

    // Sentence 2
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(0.6);
    for (let i = 0; i < 10; i++) {
      animator.update(1 / 60);
      expect(cycle.filter((m) => m.material.opacity > 0).length).toBeLessThanOrEqual(2);
    }
    expect(silentClosed.material.opacity).toBe(0);
    expect(cycle.filter((m) => m.material.opacity > 0).length).toBe(1);

    // Finish Sentence 2 -> clean return to base
    animator.setSyntheticSpeaking(false);
    for (let i = 0; i < 10; i++) animator.update(1 / 60);
    expect(silentClosed.material.opacity).toBe(1);
    expect(cycle.every((m) => m.material.opacity === 0)).toBe(true);
  });
});

describe("Lee avatar mouth transitions", () => {
  it("renders one authored pose during speech and return to rest", () => {
    const { animator, cycle, silentClosed, silentOpen } = createHarness(
      MALE.mouth,
      MALE.mouth.cycle.length,
    );
    const visiblePoses = [silentClosed, silentOpen, ...cycle];
    const visited = new Set<number>();
    const step = () => {
      animator.update(1 / 60);
      expect(visiblePoses.map((pose) => pose.material.opacity).filter(Boolean)).toEqual([1]);
      expect(visiblePoses.filter((pose) => pose.visible)).toHaveLength(1);
      visited.add(cycle.findIndex((pose) => pose.material.opacity === 1));
    };

    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(1);
    for (let frame = 0; frame < 16; frame++) step();
    expect([...visited].some((index) => index % 2 === 1)).toBe(true);
    expect(cycle.at(-1)?.material.opacity).toBe(1);

    animator.setSyntheticSpeaking(false);
    for (let frame = 0; frame < 6; frame++) step();
    expect(silentClosed.material.opacity).toBe(1);
    expect(cycle.every((pose) => pose.material.opacity === 0)).toBe(true);
  });
});

describe("Female avatar mouth transitions", () => {
  it("blends adjacent poses, limits loud peaks, and eases shut during a pause", () => {
    const { animator, cycle, silentClosed } = createHarness(FEMALE.mouth);
    const getVisiblePoses = () => cycle.flatMap((mesh, index) => mesh.material.opacity > 0 ? [index] : []);
    animator.setOpenness(1);
    animator.setSpeaking(true);

    for (let frame = 0; frame < 24; frame++) {
      animator.update(1 / 60);
      const poses = getVisiblePoses();
      expect(poses).toHaveLength(2);
      expect(poses[1]).toBe(poses[0] + 1);
      expect(cycle[5].material.opacity).toBe(0);
    }
    expect(getVisiblePoses()).toEqual([2, 3]);
    expect(cycle[3].material.opacity).toBeCloseTo(0.9, 2);
    expect(silentClosed.material.opacity).toBe(0);

    animator.setOpenness(0);
    for (let frame = 0; frame < 20; frame++) animator.update(1 / 60);
    expect(getVisiblePoses()).toEqual([0]);
    expect(silentClosed.material.opacity).toBe(0);
  });

  it("keeps the resting smile above the speaking poses during browser TTS transitions", () => {
    const { animator, cycle, silentClosed } = createHarness(FEMALE.mouth);
    animator.setSyntheticSpeaking(true);
    animator.setSyntheticOpenness(0.8);
    animator.update(1 / 60);
    expect(silentClosed.material.opacity).toBeGreaterThan(0);
    expect(silentClosed.renderOrder).toBeGreaterThan(Math.max(...cycle.map((mesh) => mesh.renderOrder)));

    for (let frame = 0; frame < 12; frame++) animator.update(1 / 60);
    animator.setSyntheticSpeaking(false);
    animator.update(1 / 60);
    expect(silentClosed.material.opacity).toBeGreaterThan(0);
    expect(silentClosed.material.opacity).toBeLessThan(1);
    expect(cycle.slice(1).some((mesh) => mesh.material.opacity > 0)).toBe(true);

    for (let frame = 0; frame < 12; frame++) animator.update(1 / 60);
    expect(silentClosed.material.opacity).toBe(1);
    expect(cycle.every((mesh) => mesh.material.opacity === 0)).toBe(true);
  });

  it("keeps moving layers out of the philtrum and feathers them into the upper lip", () => {
    const { start, end } = FEMALE.mouth.upperEdgeFeather!;
    const mask = makeMouthFeather(512, start, end);
    const pixels = mask.image.data as Uint8Array;
    const alphaAt = (spriteY: number) => pixels[(511 - spriteY) * 4 + 1];
    expect(alphaAt(300)).toBe(0);
    expect(alphaAt(304)).toBe(0);
    expect(alphaAt(307)).toBeGreaterThan(0);
    expect(alphaAt(307)).toBeLessThan(255);
    expect(alphaAt(312)).toBe(255);
    mask.dispose();
  });

  it("animates quiet PCM and closes promptly when the playback queue ends", () => {
    const { animator, cycle, silentClosed } = createHarness(FEMALE.mouth);
    const analyser = {
      fftSize: 32,
      getFloatTimeDomainData: (data: Float32Array) => data.fill(0.013),
    } as unknown as AnalyserNode;
    let hasPlayback = true;
    const driver = new LipSyncDriver(analyser, animator, undefined, undefined, () => hasPlayback);
    const step = () => { driver.update(1 / 60); animator.update(1 / 60); };
    for (let i = 0; i < 12; i++) step();
    expect(silentClosed.material.opacity).toBe(0);
    expect(cycle.slice(1).some((mesh) => mesh.material.opacity > 0)).toBe(true);

    // The analyser still has the tail sample, but it can no longer open the mouth.
    hasPlayback = false;
    for (let i = 0; i < 4; i++) step();
    expect(silentClosed.material.opacity).toBe(1);
    expect(cycle.every((mesh) => mesh.material.opacity === 0)).toBe(true);

    hasPlayback = true;
    for (let i = 0; i < 12; i++) step();
    expect(silentClosed.material.opacity).toBe(0);
  });
});
