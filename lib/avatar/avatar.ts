import * as THREE from "three";

import {
  AvatarRenderer,
  loadTextures,
  makeSpritePlane,
} from "./renderer";
import { LAYOUT_W, LAYOUT_H, pixiToThree } from "./positions";
import { CharacterConfig, FEMALE, Layer, characterUrls } from "./characters";
import { MouthAnimator } from "./mouth-animator";
import { BlinkAnimator } from "./blink-animator";
import { BodyAnimator } from "./body-animator";
import { BodySwayAnimator } from "./body-sway";
import { EyeGazeAnimator } from "./eye-gaze";
import { EyebrowAnimator } from "./eyebrow-animator";
import { HeadSwayAnimator } from "./head-sway";
import { LipSyncDriver } from "./lip-sync";

/**
 * Top-level facade that owns the renderer, all animators, and exposes a small
 * imperative API for components.
 *
 * The scene graph is built from a `CharacterConfig` (female by default), so the
 * same renderer + animators drive either the female or the male sprite set.
 *
 * Lifecycle: `new Avatar(canvas, config)` -> `await load()` -> `start()`.
 * Components call `attachAnalyser`, `onTalkStart`, `onTalkEnd`, `setSpeaking`.
 */
export class Avatar {
  private readonly renderer: AvatarRenderer;
  private readonly config: CharacterConfig;

  private mouthAnimator!: MouthAnimator;
  private blinkAnimator!: BlinkAnimator;
  private bodyAnimator!: BodyAnimator;
  private bodySway!: BodySwayAnimator;
  private eyeGaze!: EyeGazeAnimator;
  private eyebrowAnimator!: EyebrowAnimator;
  private headSway!: HeadSwayAnimator;
  private lipSync: LipSyncDriver | null = null;

  private swayGroup!: THREE.Group;
  private bodyGroup!: THREE.Group;
  private armLeftGroup!: THREE.Group;
  private armRightGroup!: THREE.Group;
  private eyeballGroup!: THREE.Group;
  private headGroup!: THREE.Group;

  // Dev calibration registry: static-position face-area layers the
  // avatar-calibrator can nudge pixel-by-pixel. dx/dy accumulate the Pixi-space
  // nudge so the panel can read back the value to bake into the character config.
  private readonly calLayers = new Map<
    string,
    {
      meshes: THREE.Object3D[];
      baseX: number;
      baseY: number;
      baseZ: number;
      dx: number;
      dy: number;
    }
  >();

  // Dev calibration: a whole-avatar offset (screen px) added on top of the
  // computed fit position, so the entire figure can be repositioned at once.
  private readonly rootOffset = { x: 0, y: 0 };

  private loaded = false;
  private speakingOverride = false;

  constructor(canvas: HTMLCanvasElement, config: CharacterConfig = FEMALE) {
    this.renderer = new AvatarRenderer(canvas);
    this.config = config;
  }

  /** Preload every sprite the character references and build the scene graph. */
  async load(): Promise<void> {
    if (this.loaded) return;
    const textures = await loadTextures(characterUrls(this.config));
    this.buildSceneGraph(textures);
    this.fitToCanvas();
    this.registerTickers();
    this.loaded = true;
  }

  start(): void {
    this.renderer.start();
  }

  resize(): void {
    this.renderer.resize();
    this.fitToCanvas();
  }

  dispose(): void {
    this.renderer.dispose();
  }

  /**
   * Wire an `AnalyserNode` from the audio playback queue so the mouth can
   * react to model audio amplitude. Safe to call after the audio context
   * is created (usually after the first user gesture).
   *
   * Only replaces the LipSyncDriver — the ticker was registered once in
   * `registerTickers()` so reconnects never accumulate duplicate tickers.
   */
  attachAnalyser(analyser: AnalyserNode): void {
    // Lock gaze to eye contact while audio is playing; resume idle wandering
    // when it stops. Secondary motion: a small eyebrow raise on stressed
    // syllables (male only - it accompanies the amplitude-driven mouth).
    const onAccent =
      this.config.id === "male"
        ? () => this.eyebrowAnimator.trigger("raiseSmall")
        : undefined;
    this.lipSync = new LipSyncDriver(
      analyser,
      this.mouthAnimator,
      (speaking) => this.eyeGaze.setSpeaking(speaking),
      onAccent,
    );
  }

  /** Bypass amplitude-driven lip sync (e.g. browser speechSynthesis fallback). */
  setSpeakingOverride(speaking: boolean): void {
    this.speakingOverride = speaking;
    this.mouthAnimator.setSyntheticSpeaking(speaking);
    this.bodyAnimator.setSpeaking(speaking);
    this.blinkAnimator.setSpeaking(speaking);
    this.headSway.setSpeaking(speaking);
    this.bodySway.setSpeaking(speaking);
    this.eyeGaze.setSpeaking(speaking);
  }

  /**
   * Drive mouth openness (0..1) from browser `speechSynthesis` word boundaries
   * and punctuation pauses while `speakingOverride` is active. Pass `null` to
   * let MouthAnimator use its estimated syllable rhythm.
   */
  setSpeakingOpenness(openness: number | null): void {
    this.mouthAnimator.setSyntheticOpenness(openness);
  }

  onTalkStart(fromStandby = false): void {
    // Unity SetVoiceFg(true) fires multiple animators in parallel: blink +
    // body action + head shake (sway already runs) + eyebrow large + arm
    // spread. The web previously only triggered body + eyebrow which made
    // the avatar feel static at the start of an utterance (parity #35).
    this.bodyAnimator.onTalkStart();
    this.blinkAnimator.triggerBlink();
    this.eyebrowAnimator.trigger(fromStandby ? "raiseLarge" : "raiseSmall");
  }

  onTalkEnd(): void {
    // Unity SetVoiceFg(false): blink + eyebrow small + arm pull-in.
    this.bodyAnimator.onTalkEnd();
    this.blinkAnimator.triggerBlink();
    this.eyebrowAnimator.trigger("raiseSmall");
    window.setTimeout(() => this.bodyAnimator.resetGesture(), 1200);
  }

  // --- Dev calibration API (avatar-calibrator) -----------------------------

  /** Layer names the calibrator can nudge, in registration order. */
  calLayerNames(): string[] {
    return [...this.calLayers.keys()];
  }

  /** Nudge a layer by a Pixi-space delta (x: right+, y: down+). */
  nudgeCalLayer(name: string, dxPixi: number, dyPixi: number): void {
    const e = this.calLayers.get(name);
    if (!e) return;
    e.dx += dxPixi;
    e.dy += dyPixi;
    // Pixi x maps 1:1 to Three x; Pixi y is inverted (down+ -> Three down).
    for (const m of e.meshes) {
      m.position.x += dxPixi;
      m.position.y -= dyPixi;
    }
  }

  /**
   * Current Pixi anchor (base + accumulated nudge) + draw-order z, plus the
   * deltas from the config baseline (dx/dy/dz), for the calibrator read-out.
   */
  calLayerAnchor(name: string): {
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    dz: number;
  } | null {
    const e = this.calLayers.get(name);
    if (!e) return null;
    const z = e.meshes[0]?.position.z ?? 0;
    return {
      x: e.baseX + e.dx,
      y: e.baseY + e.dy,
      z,
      dx: e.dx,
      dy: e.dy,
      dz: z - e.baseZ,
    };
  }

  /**
   * Shift a layer's draw order (z) by `delta`, applied to every mesh in the
   * layer so intra-layer spread (blink/mouth frames) is preserved. Sprites use
   * depthTest:false, so a larger z draws in front. Read the new z back from
   * `calLayerAnchor` to bake into the character config.
   */
  bumpCalLayerZ(name: string, delta: number): void {
    const e = this.calLayers.get(name);
    if (!e) return;
    for (const m of e.meshes) m.position.z += delta;
  }

  /** Move the whole avatar by a screen-pixel delta (x: right+, y: down+). */
  nudgeRoot(dx: number, dy: number): void {
    this.rootOffset.x += dx;
    this.rootOffset.y -= dy; // screen down+ -> Three down
    this.fitToCanvas();
  }

  /** Clear the whole-avatar offset back to the computed fit position. */
  resetRoot(): void {
    this.rootOffset.x = 0;
    this.rootOffset.y = 0;
    this.fitToCanvas();
  }

  /** Current whole-avatar offset (screen px), for read-out. */
  rootOffsetValue(): { x: number; y: number } {
    return { x: this.rootOffset.x, y: this.rootOffset.y };
  }

  /**
   * Zoom the camera into a layer so a small seam fills the canvas. `name=null`
   * or `factor<=1` resets to the normal view.
   */
  setCalZoom(name: string | null, factor: number): void {
    const mesh = name ? this.calLayers.get(name)?.meshes[0] : null;
    if (!mesh || factor <= 1) {
      this.renderer.setZoom(1, 0, 0);
      return;
    }
    const v = new THREE.Vector3();
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldPosition(v);
    this.renderer.setZoom(factor, v.x, v.y);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildSceneGraph(textures: Map<string, THREE.Texture>): void {
    const c = this.config;
    const root = this.renderer.root;

    const tex = (url: string): THREE.Texture => {
      const t = textures.get(url);
      if (!t) throw new Error(`Missing texture: ${url}`);
      return t;
    };

    const place = (
      mesh: THREE.Object3D,
      anchor: { x: number; y: number },
      z: number,
    ): void => {
      const [x, y] = pixiToThree(anchor.x, anchor.y);
      mesh.position.set(x, y, z);
    };

    // Sway group wraps the WHOLE avatar (body + neck + head). The breathing
    // scale and the side-to-side sway both target this group so every layer
    // moves as one - the breath inflates the whole bust together (no body-vs-
    // head bob) and the sway rocks the whole figure (client 2026-06-26).
    this.swayGroup = new THREE.Group();
    root.add(this.swayGroup);

    // Head sway pivot: the base of the neck. Face-area sprites live in
    // `headGroup` (positioned here) so a small Z-rotation tilts the whole head
    // around the neck instead of spinning about the scene centre (parity #33).
    const [pivotX, pivotY] = pixiToThree(c.neck.anchor.x, c.neck.anchor.y);
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(pivotX, pivotY, 0);
    this.swayGroup.add(this.headGroup);

    // Like `place`, but for sprites parented to `headGroup` - subtracts the
    // pivot so the sprite keeps its authored world position.
    const placeHead = (
      mesh: THREE.Object3D,
      anchor: { x: number; y: number },
      z: number,
    ): void => {
      const [x, y] = pixiToThree(anchor.x, anchor.y);
      mesh.position.set(x - pivotX, y - pivotY, z);
    };

    // Body group is the rig parent for breathing scale and arm offsets. The
    // body is a stack (one flat sprite for the female; layered for the male).
    this.bodyGroup = new THREE.Group();
    this.swayGroup.add(this.bodyGroup);

    const bodyMeshes: { mesh: THREE.Object3D; layer: Layer }[] = [];
    for (const layer of c.body) {
      const m = makeSpritePlane(tex(layer.url), 0);
      place(m, layer.anchor, layer.z);
      this.bodyGroup.add(m);
      bodyMeshes.push({ mesh: m, layer });
    }

    // Arms - own groups so the gesture animator can translate them. Always
    // present (the body animator drives them); meshes only added when the
    // character has separate arm sprites (a flat body skips them).
    this.armLeftGroup = new THREE.Group();
    this.armRightGroup = new THREE.Group();
    if (c.arms) {
      const armLeftMesh = makeSpritePlane(tex(c.arms.left.url), 0);
      place(armLeftMesh, c.arms.left.anchor, c.arms.left.z);
      this.armLeftGroup.add(armLeftMesh);
      const armRightMesh = makeSpritePlane(tex(c.arms.right.url), 0);
      place(armRightMesh, c.arms.right.anchor, c.arms.right.z);
      this.armRightGroup.add(armRightMesh);
    }
    this.bodyGroup.add(this.armLeftGroup, this.armRightGroup);

    // Neck + face. `renderNeck: false` (male) skips adding the sprite - its
    // face.png already bakes the neck in - but `c.neck.anchor` is still used
    // above as the head-sway pivot regardless.
    const neckMesh = makeSpritePlane(tex(c.neck.url), 0);
    place(neckMesh, c.neck.anchor, c.neck.z);
    if (c.renderNeck !== false) this.swayGroup.add(neckMesh);

    const faceMesh = makeSpritePlane(tex(c.face.url), 0);
    placeHead(faceMesh, c.face.anchor, c.face.z);
    this.headGroup.add(faceMesh);

    // Eye-background layers (whites / shadow / base) - hidden during a blink.
    const eyeBgMeshes = c.eyeBg.map((l) => {
      const m = makeSpritePlane(tex(l.url), 0);
      placeHead(m, l.anchor, l.z);
      this.headGroup.add(m);
      return m;
    });

    // Eyeballs - the gaze animator translates the whole group; each iris sits
    // at its own offset relative to head centre.
    this.eyeballGroup = new THREE.Group();
    const [headX, headY] = pixiToThree(c.head.x, c.head.y);
    const eyeRestX = headX - pivotX;
    const eyeRestY = headY - pivotY;
    this.eyeballGroup.position.set(eyeRestX, eyeRestY, c.eyeballLeft.z);
    const eyeballLeftMesh = makeSpritePlane(tex(c.eyeballLeft.url), 0);
    eyeballLeftMesh.position.set(
      c.eyeballLeft.anchor.x - c.head.x,
      c.head.y - c.eyeballLeft.anchor.y,
      0,
    );
    this.eyeballGroup.add(eyeballLeftMesh);
    const eyeballRightMesh = makeSpritePlane(tex(c.eyeballRight.url), 0);
    eyeballRightMesh.position.set(
      c.eyeballRight.anchor.x - c.head.x,
      c.head.y - c.eyeballRight.anchor.y,
      0,
    );
    this.eyeballGroup.add(eyeballRightMesh);
    this.headGroup.add(this.eyeballGroup);

    // Blink frames - 4 lid frames stacked at the blink anchor, alpha-blended by
    // the animator. All start hidden: the rest state shows the gaze eyes
    // underneath; lids only appear during a blink.
    const bf = c.blink.frames;
    const blinkOpen = makeSpritePlane(tex(bf.open), 0);
    placeHead(blinkOpen, c.blink.anchor, c.blink.z);
    const blinkOpenToClose = makeSpritePlane(tex(bf.openToClose), 0);
    placeHead(blinkOpenToClose, c.blink.anchor, c.blink.z + 0.001);
    const blinkClose = makeSpritePlane(tex(bf.close), 0);
    placeHead(blinkClose, c.blink.anchor, c.blink.z + 0.002);
    const blinkCloseToOpen = makeSpritePlane(tex(bf.closeToOpen), 0);
    placeHead(blinkCloseToOpen, c.blink.anchor, c.blink.z + 0.003);
    blinkOpen.material.opacity = 0;
    blinkOpenToClose.material.opacity = 0;
    blinkClose.material.opacity = 0;
    blinkCloseToOpen.material.opacity = 0;
    this.headGroup.add(blinkOpen, blinkOpenToClose, blinkClose, blinkCloseToOpen);

    // Optional smooth-descent lid frames (male): each a full lid pose, stacked
    // just above the 4-slot frames. The animator plays them forward then back
    // for a smooth eyelid close; the 4-slot frames stay hidden when set.
    const blinkSeq = (c.blink.closeFrames ?? []).map((url, i) => {
      const m = makeSpritePlane(tex(url), 0);
      placeHead(m, c.blink.anchor, c.blink.z + 0.01 + i * 0.001);
      m.material.opacity = 0;
      this.headGroup.add(m);
      return m;
    });

    // Bangs (male) - static front hair drawn over the brows/forehead.
    let bangsMesh: THREE.Mesh | null = null;
    if (c.bangs) {
      bangsMesh = makeSpritePlane(tex(c.bangs.url), 0);
      placeHead(bangsMesh, c.bangs.anchor, c.bangs.z);
      this.headGroup.add(bangsMesh);
    }

    // Eyebrows - own anchors, position animated by the eyebrow animator.
    const eyebrowLeftMesh = makeSpritePlane(tex(c.eyebrows.left.url), 0);
    placeHead(eyebrowLeftMesh, c.eyebrows.left.anchor, c.eyebrows.left.z);
    const eyebrowRightMesh = makeSpritePlane(tex(c.eyebrows.right.url), 0);
    placeHead(eyebrowRightMesh, c.eyebrows.right.anchor, c.eyebrows.right.z);
    this.headGroup.add(eyebrowLeftMesh, eyebrowRightMesh);

    // Mouth stack - cycle frames anchored at the mouth pixel position.
    const mouthCycle = c.mouth.cycle.map((url, i) => {
      const m = makeSpritePlane(tex(url), 0);
      placeHead(m, c.mouth.anchor, c.mouth.z + i * 0.001);
      m.material.opacity = 0;
      this.headGroup.add(m);
      return m;
    });

    // Backdrop: same closed-lips texture as the silent-closed overlay, pinned
    // at a lower z so it always sits BEHIND the speaking cycle frames - keeps
    // the face's baked-in mouth area covered even when every cycle frame is
    // mid-fade (parity #38). Opacity locked at 1; the animator never touches it.
    const mouthSilentBackdrop = makeSpritePlane(tex(c.mouth.backdrop), 0);
    placeHead(mouthSilentBackdrop, c.mouth.anchor, c.mouth.zBackdrop);
    mouthSilentBackdrop.material.opacity = 1;
    this.headGroup.add(mouthSilentBackdrop);

    const mouthSilentClosed = makeSpritePlane(tex(c.mouth.silentClosed), 0);
    placeHead(mouthSilentClosed, c.mouth.anchor, c.mouth.zSilent);
    mouthSilentClosed.material.opacity = 1;
    this.headGroup.add(mouthSilentClosed);

    const mouthSilentOpen = makeSpritePlane(tex(c.mouth.silentOpen), 0);
    placeHead(mouthSilentOpen, c.mouth.anchor, c.mouth.zSilent + 0.001);
    mouthSilentOpen.material.opacity = 0;
    this.headGroup.add(mouthSilentOpen);

    // Calibration registry (dev avatar-calibrator). Only STATIC-position
    // face-area layers - animator-driven transforms (eyebrows, eyeball gaze
    // group, head sway, body) are excluded. The eyeball meshes themselves sit
    // static inside the gaze group, so nudging them is stable.
    const regCal = (
      name: string,
      anchor: { x: number; y: number },
      ...meshes: THREE.Object3D[]
    ) =>
      this.calLayers.set(name, {
        meshes,
        baseX: anchor.x,
        baseY: anchor.y,
        baseZ: meshes[0]?.position.z ?? 0,
        dx: 0,
        dy: 0,
      });
    const calName = (url: string) =>
      url.split("/").pop()?.replace(/\.png$/i, "") ?? url;
    // Body sub-sprites first so the panel lists them in back-to-front order -
    // lets the male collar/shirt/tie/suit/neck z-stack be reordered live.
    bodyMeshes.forEach(({ mesh, layer }) =>
      regCal(calName(layer.url), layer.anchor, mesh),
    );
    regCal("face", c.face.anchor, faceMesh);
    regCal("neck", c.neck.anchor, neckMesh);
    if (c.bangs && bangsMesh) regCal("bangs", c.bangs.anchor, bangsMesh);
    c.eyeBg.forEach((l, i) => regCal(calName(l.url), l.anchor, eyeBgMeshes[i]));
    regCal("eyeballLeft", c.eyeballLeft.anchor, eyeballLeftMesh);
    regCal("eyeballRight", c.eyeballRight.anchor, eyeballRightMesh);
    regCal("blink", c.blink.anchor, blinkOpen, blinkOpenToClose, blinkClose, blinkCloseToOpen, ...blinkSeq);
    regCal("mouth", c.mouth.anchor, ...mouthCycle);
    regCal(
      "mouthSilent",
      c.mouth.anchor,
      mouthSilentBackdrop,
      mouthSilentClosed,
      mouthSilentOpen,
    );

    // Animator wiring -------------------------------------------------------

    this.mouthAnimator = new MouthAnimator(
      {
        cycle: mouthCycle,
        silentClosed: mouthSilentClosed,
        silentOpen: mouthSilentOpen,
      },
      {
        fadeInRate: c.mouth.fadeInRate,
        fadeOutRate: c.mouth.fadeOutRate,
        frameTime: c.mouth.frameTime,
        minFrameTime: c.mouth.minFrameTime,
        silentCloseRate: c.mouth.silentCloseRate,
        mode: c.mouth.mode,
        blendAdjacentFrames: c.mouth.blendAdjacentFrames,
      },
    );

    this.blinkAnimator = new BlinkAnimator(
      {
        open: blinkOpen,
        openToClose: blinkOpenToClose,
        close: blinkClose,
        closeToOpen: blinkCloseToOpen,
        sequence: blinkSeq.length ? blinkSeq : undefined,
        // Hide all eye-background layers during a blink: the gaze group
        // (irises) PLUS the bg layers (whites/shadow/base) whose visible area
        // extends beyond the eyelid frame's coverage. Unless keepEyeBg (male),
        // whose top-layer lid covers the closed eye and looks better with the
        // live eye left visible under the near-open frames.
        eyeBgLayers: [...eyeBgMeshes, this.eyeballGroup],
        keepEyeBg: c.blink.keepEyeBgDuringBlink ?? false,
      },
      {
        onBlinkStart: () => {
          this.eyeGaze.lockGaze();
          // Unity DoEyebrowAction(3) on blink start: a small downward bob in
          // sync with the eyelids (parity #32).
          this.eyebrowAnimator.trigger("lowerSmall");
        },
        onBlinkEnd: () => this.eyeGaze.unlock(),
      },
    );

    // Breathing scales the whole-avatar swayGroup (not just the body sprites)
    // so the bust inflates as one instead of the body bobbing under a fixed head.
    this.bodyAnimator = new BodyAnimator(
      this.swayGroup,
      this.armLeftGroup,
      this.armRightGroup,
    );
    this.bodySway = new BodySwayAnimator(this.swayGroup);

    this.eyeGaze = new EyeGazeAnimator(
      this.eyeballGroup,
      new THREE.Vector3(eyeRestX, eyeRestY, c.eyeballLeft.z),
      c.gaze,
    );

    this.eyebrowAnimator = new EyebrowAnimator({
      left: eyebrowLeftMesh,
      right: eyebrowRightMesh,
    });

    this.headSway = new HeadSwayAnimator(this.headGroup, c.headSwayScale ?? 1);
  }

  /**
   * Scale the root group so the layout canvas fits inside the actual rendering
   * canvas, then anchor the character's visual bottom to the bottom of the
   * visible area so it always appears grounded on the bottom bar regardless of
   * screen size or zoom level. Fit constants come from the character config.
   */
  private fitToCanvas(): void {
    const root = this.renderer.root;
    const { left, right, top, bottom } = this.renderer.camera;
    const canvasW = right - left;
    const canvasH = top - bottom;
    // Landscape (desktop): pure `contain` fit so the layout canvas matches a CSS
    // `object-contain` overlay 1:1 (the ?cal=1 calibration overlay relies on this).
    // Portrait (mobile): fit to HEIGHT so head+shoulders fill the frame.
    const portrait = canvasH > canvasW;
    const scale = portrait
      ? canvasH / LAYOUT_H
      : Math.min(canvasW / LAYOUT_W, canvasH / LAYOUT_H);
    const es = scale * this.config.fit.scale;
    root.scale.setScalar(es);

    const VISUAL_BOTTOM_Y = this.config.fit.visualBottomY;
    const AVATAR_TOP_Y = this.config.fit.avatarTopY;
    const BAR_HEIGHT_PX = portrait ? 0 : this.config.fit.barHeightPx;

    // Anchor the sprite's hard bottom edge to the bar (tucked behind it).
    const targetY = -(canvasH / 2) + BAR_HEIGHT_PX - VISUAL_BOTTOM_Y * es;
    // Ceiling: on very small screens, keep the head from clipping above the top.
    const ceiling = canvasH / 2 - AVATAR_TOP_Y * es;

    // Whole-avatar offsets (screen px) are applied AFTER the bottom/ceiling
    // clamp so they always move the figure - the baked `offset*Px` and the live
    // dev nudge `rootOffset` behave identically (folding them into targetY would
    // let the ceiling clamp swallow them for a tall avatar like the male).
    const { offsetXPx, offsetYPx } = this.config.fit;
    root.position.set(
      offsetXPx + this.rootOffset.x,
      Math.min(targetY, ceiling) + offsetYPx + this.rootOffset.y,
      0,
    );
  }

  private registerTickers(): void {
    this.renderer.addTicker((dt) => this.mouthAnimator.update(dt));
    this.renderer.addTicker((dt) => this.blinkAnimator.update(dt));
    this.renderer.addTicker((dt) => this.bodyAnimator.update(dt));
    this.renderer.addTicker((dt) => this.bodySway.update(dt));
    this.renderer.addTicker((dt) => this.eyeGaze.update(dt));
    this.renderer.addTicker((dt) => this.eyebrowAnimator.update(dt));
    this.renderer.addTicker((dt) => this.headSway.update(dt));
    // LipSync ticker is here (not in attachAnalyser) so reconnects that call
    // attachAnalyser again only swap the LipSyncDriver instance; the renderer
    // never accumulates duplicate tickers that corrupt the hysteresis timer.
    this.renderer.addTicker((dt) => {
      if (!this.speakingOverride) this.lipSync?.update(dt);
    });
  }
}
