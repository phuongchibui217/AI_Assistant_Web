/**
 * Character descriptors. The avatar engine (`avatar.ts`) builds its scene graph
 * from one of these, so the same animators/renderer drive either the female
 * (富士崎) or the male (高崎, placeholder) sprite set.
 *
 * Anchors are in the shared Pixi layout space (1536x1024, see positions.ts).
 * The female config reuses the existing, calibrated POS/Z/sprite-layers values
 * verbatim so swapping to a config-driven build does not move the female
 * avatar. The male config is a FIRST DRAFT to be calibrated with the in-app
 * avatar-calibrator (its sprites are pre-aligned in one 850x850 canvas, so all
 * face-area layers share a single anchor).
 */

import {
  STATIC_LAYERS,
  MOUTH_CYCLE_FRAMES,
  MOUTH_BACKDROP,
  MOUTH_SILENT_CLOSED,
  MOUTH_SILENT_OPEN,
  BLINK_FRAMES,
} from "./sprite-layers";
import { POS, Z } from "./positions";

export type Anchor = { x: number; y: number };
export type Layer = { url: string; anchor: Anchor; z: number };

export type CharacterConfig = {
  id: "female" | "male";

  /** Head centre - eyeball-group rest position + gaze reference. */
  head: Anchor;

  /**
   * Idle eye-gaze amplitude (layout px). Glances are picked symmetrically in
   * [-amp, +amp] around the eye anchor, so the iris can look up/down/left/right.
   * Per-character because the female 512 face needs a smaller swing than the
   * male 850 face to read naturally.
   */
  gaze: { ampX: number; ampY: number };

  /**
   * Optional multiplier on independent head-vs-body tilt amplitude (default 1).
   * Lower values keep continuous long hair draped across the shoulder from
   * shearing at the head/body split while BodySwayAnimator still sways the
   * whole figure naturally.
   */
  headSwayScale?: number;

  /**
   * Fit tuning (pre-scale Three.js units). `scale` is the fraction of the
   * contain-fit applied; visualBottomY/avatarTopY anchor the sprite stack's
   * hard bottom/top edges; barHeightPx tucks the bottom edge behind the bar.
   */
  fit: {
    scale: number;
    visualBottomY: number;
    avatarTopY: number;
    barHeightPx: number;
    /** Whole-avatar offset in screen px (dev-calibrated via the `G` mode). */
    offsetXPx: number;
    offsetYPx: number;
  };

  /** Body sprite stack, back-to-front by z. A single flat sprite for the
   *  female; layered (shirt/tie/collar/suit) for the male so the neck can sit
   *  between the shirt and the jacket. */
  body: Layer[];
  /** Separate arm groups for the wave gesture; null when the body is flat. */
  arms: { left: Layer; right: Layer } | null;
  neck: Layer;
  /** Whether `neck` is actually rendered as its own sprite. The female neck is
   *  a separate piece (calibrated, default true). The male `face.png` already
   *  bakes the neck in, so adding the separate sprite on top just doubled it
   *  and the two drifted apart under sway (different parents) - set false to
   *  skip rendering while still keeping `neck.anchor` as the head-sway pivot. */
  renderNeck?: boolean;
  face: Layer;
  /** Front hair, drawn over the face (male set only). */
  bangs: Layer | null;

  /**
   * Eye-background layers hidden during a blink (the open eye that the lids
   * cover). Female: eye base + white + white-shadow. Male: the split L/R
   * whites. The moving irises are added separately below.
   */
  eyeBg: Layer[];
  eyeballLeft: Layer;
  eyeballRight: Layer;

  /** 4 lid frames mapped onto the blink animation slots. */
  blink: {
    frames: {
      open: string;
      openToClose: string;
      close: string;
      closeToOpen: string;
    };
    /**
     * Optional ordered lid frames from just-past-open to fully closed (e.g. the
     * male blink_2..blink_5). When present the animator plays the full descent
     * forward then reverses it, giving a smooth eyelid close instead of the
     * coarse 3-slot swap. Omit for the female (keeps her calibrated 4-slot blink).
     */
    closeFrames?: readonly string[];
    /** When true, keep the eye-background layers visible during a blink. The
     *  male lid sits on the top avatar layer and covers the closed eye fully, so
     *  the live eye should stay visible under the near-open frames rather than
     *  exposing the baked-open eye. Omit/false for the female (she hides them). */
    keepEyeBgDuringBlink?: boolean;
    anchor: Anchor;
    z: number;
  };

  eyebrows: { left: Layer; right: Layer };

  mouth: {
    cycle: readonly string[];
    silentClosed: string;
    silentOpen: string;
    /** Always-on closed-lips backdrop behind the cycle frames. */
    backdrop: string;
    anchor: Anchor;
    z: number;
    zSilent: number;
    zBackdrop: number;
    /** Cross-fade rate between talking frames (lower = slower/smoother). */
    fadeInRate: number;
    fadeOutRate: number;
    /** Seconds per cycle frame (defaults to 0.12). Halve it when the cycle has
     *  twice as many (interpolated) frames so the mouth speed stays the same. */
    frameTime?: number;
    /** End-of-utterance closed-mouth fade-in rate (defaults to the slow ~0.3s
     *  ease). Set fast for a mouthless backdrop so no gap exposes it. */
    silentCloseRate?: number;
    /** "cycle" (default) = timer loop; "amplitude" = frame tracks the audio
     *  envelope so the mouth opening matches the sound. */
    mode?: "cycle" | "amplitude";
    /** Minimum hold time per frame in amplitude mode (seconds). */
    minFrameTime?: number;
    /** Blend adjacent poses as the audio envelope rises or falls. */
    blendAdjacentFrames?: boolean;
  };
};

/** Every texture URL a config references, for preloading. */
export function characterUrls(c: CharacterConfig): string[] {
  const urls: string[] = [
    ...c.body.map((l) => l.url),
    c.neck.url,
    c.face.url,
    c.eyeballLeft.url,
    c.eyeballRight.url,
    c.eyebrows.left.url,
    c.eyebrows.right.url,
    c.blink.frames.open,
    c.blink.frames.openToClose,
    c.blink.frames.close,
    c.blink.frames.closeToOpen,
    ...(c.blink.closeFrames ?? []),
    c.mouth.silentClosed,
    c.mouth.silentOpen,
    c.mouth.backdrop,
    ...c.mouth.cycle,
    ...c.eyeBg.map((l) => l.url),
  ];
  if (c.arms) urls.push(c.arms.left.url, c.arms.right.url);
  if (c.bangs) urls.push(c.bangs.url);
  return [...new Set(urls)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Female (current, calibrated) - assembled from the existing POS/Z/sprite-layers
// so the config-driven build reproduces the hand-tuned avatar exactly.
// ─────────────────────────────────────────────────────────────────────────────
export const FEMALE: CharacterConfig = {
  id: "female",
  head: POS.head,
  // Balanced gaze amplitude for Chi's eye aperture (checked at +-2.6/+-1.6).
  gaze: { ampX: 2.6, ampY: 1.6 },
  // Natural independent head tilt (~+-0.825 deg idle) while keeping the long
  // hair draped across her right shoulder seamless against Body_700.
  headSwayScale: 0.55,
  fit: {
    scale: 0.85,
    visualBottomY: -512,
    avatarTopY: 455,
    barHeightPx: 70,
    offsetXPx: 0,
    offsetYPx: 0,
  },
  body: [{ url: STATIC_LAYERS.body, anchor: POS.body, z: Z.body }],
  // Natural clasped arms are baked into Body_700.png (same pattern as MALE).
  arms: null,
  // Neck is baked into Face_512.png and tucked behind Body_700's choker; kept
  // here solely as the head-sway pivot anchor (same pattern as MALE).
  neck: { url: STATIC_LAYERS.neck, anchor: POS.neck, z: Z.neck },
  renderNeck: false,
  face: { url: STATIC_LAYERS.face, anchor: POS.face, z: Z.face },
  bangs: { url: STATIC_LAYERS.bangs, anchor: POS.bangs, z: Z.bangs },
  eyeBg: [
    { url: STATIC_LAYERS.eyeWhite, anchor: POS.eyeWhite, z: Z.eyeWhite },
    {
      url: STATIC_LAYERS.eyeWhiteShadow,
      anchor: POS.eyeWhiteShadow,
      z: Z.eyeWhiteShadow,
    },
    { url: STATIC_LAYERS.eyeBase, anchor: POS.eyeBase, z: Z.eyeBase },
  ],
  eyeballLeft: {
    url: STATIC_LAYERS.eyeballLeft,
    anchor: POS.eyeballLeft,
    z: Z.eyeball,
  },
  eyeballRight: {
    url: STATIC_LAYERS.eyeballRight,
    anchor: POS.eyeballRight,
    z: Z.eyeball,
  },
  blink: {
    frames: {
      open: BLINK_FRAMES.open,
      openToClose: BLINK_FRAMES.openToClose,
      close: BLINK_FRAMES.close,
      closeToOpen: BLINK_FRAMES.closeToOpen,
    },
    anchor: POS.blink,
    z: Z.blink,
  },
  eyebrows: {
    left: { url: STATIC_LAYERS.eyebrowLeft, anchor: POS.eyebrowLeft, z: Z.eyebrow },
    right: {
      url: STATIC_LAYERS.eyebrowRight,
      anchor: POS.eyebrowRight,
      z: Z.eyebrow,
    },
  },
  mouth: {
    cycle: MOUTH_CYCLE_FRAMES,
    silentClosed: MOUTH_SILENT_CLOSED,
    silentOpen: MOUTH_SILENT_OPEN,
    // Mouthless skin backdrop (like MALE) so baked closed lips never peek out
    // behind open mouth shapes while talking.
    backdrop: MOUTH_BACKDROP,
    anchor: POS.mouth,
    z: Z.mouth,
    zSilent: Z.mouthSilent,
    zBackdrop: Z.mouthSilentBackdrop,
    fadeInRate: 16,
    fadeOutRate: 40,
    silentCloseRate: 10,
    mode: "amplitude",
    blendAdjacentFrames: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Male (高崎, placeholder) - DRAFT positions to be calibrated in-app. Sprites
// are pre-aligned in one 850x850 canvas, so every face-area layer shares
// `mFace`; only the body/neck differ. Assets under /avatar-male/ (ascii names).
// ─────────────────────────────────────────────────────────────────────────────
const M = "/avatar-male";
// Shared face anchor (all male face-area sprites are pre-aligned in the 850 canvas).
const mFace: Anchor = { x: 768, y: 240 };
// Shared body anchor (all body sub-sprites are pre-aligned in the 1273x1770 canvas).
const mBody: Anchor = { x: 775, y: 1254 };
// Z stack, calibrated in-app. The whole face stack was pushed behind the body
// (face 0.02 < shirt/tie/collar/suit) so the jacket collar covers the jaw/neck;
// only the eyes/blink/mouth/bangs stay in front of the suit.
const mZ = {
  collarBack: 0.01,
  shirt: 0.03,
  tie: 0.03,
  collar: 0.06,
  suit: 0.06,
  arm: 0.08, // shirt sleeves/cuffs (体_腕左/右), over the jacket front
  neck: -0.57, // tucked fully behind the body stack
  face: 0.02, // behind the suit collar so the jacket covers the jaw
  eyeWhite: 0.12,
  eyeball: 0.14,
  mouthBackdrop: 0.29,
  bangs: 0.3,
  mouth: 0.32,
  mouthSilent: 0.37,
  // Blink lifted above the eye/mouth/bangs stack but kept BELOW the eyebrow so
  // the brows read over the closed lid. The lid must sit on top of everything in
  // the eye region to fully cover the baked-open eye in face.png (2026-07-19).
  blink: 0.8,
  eyebrow: 0.85, // not in-app calibratable; left in front so brows read clearly
};

export const MALE: CharacterConfig = {
  id: "male",
  head: mFace,
  // Larger swing than the female: the 850 face is scaled down more, so the
  // iris needs a bigger px offset for the same on-screen movement.
  gaze: { ampX: 8, ampY: 6.6 },
  // Scaled so the male shoulders match the female's on-screen width
  // (female 633px @ 0.85 vs male 1195px -> 0.85 * 633/1195). visualBottomY is
  // the body plane's bottom edge (anchor 1382 + 1770/2); avatarTopY the face
  // plane top (mFace 300 - 850/2). Fine-tune vertical framing with these two.
  fit: {
    scale: 0.45,
    visualBottomY: -1755,
    avatarTopY: 637,
    barHeightPx: 70,
    offsetXPx: 0,
    offsetYPx: -75, // calibrated whole-avatar nudge (screen px)
  },
  // Body layered (all share the 1273x1770 canvas at one anchor). Face and body
  // anchors are calibrated independently in-app (the neck z=0.01 sits behind the
  // body stack, so a small face/body vertical gap is hidden by the suit).
  body: [
    { url: `${M}/collar_back.png`, anchor: mBody, z: mZ.collarBack },
    { url: `${M}/shirt.png`, anchor: mBody, z: mZ.shirt },
    { url: `${M}/tie.png`, anchor: mBody, z: mZ.tie },
    { url: `${M}/arm_right.png`, anchor: { x: 773, y: 1243 }, z: mZ.arm },
    { url: `${M}/arm_left.png`, anchor: { x: 783, y: 1228 }, z: mZ.arm },
    { url: `${M}/collar.png`, anchor: mBody, z: mZ.collar },
    { url: `${M}/suit.png`, anchor: { x: 775, y: 1251 }, z: mZ.suit },
  ],
  // Static sleeves are part of the body stack above; no wave-gesture arm groups.
  arms: null,
  // Neck (顔_首) is in the pre-aligned 850 face canvas (shares mFace) and sits
  // at z between the shirt assembly and the jacket.
  // face.png already bakes the neck in; the separate sprite drifted apart from
  // it under sway (different parents) and doubled up, so it's kept only as
  // the head-sway pivot anchor, not actually rendered (renderNeck: false).
  neck: { url: `${M}/neck.png`, anchor: { x: mFace.x - 2, y: mFace.y }, z: mZ.neck },
  renderNeck: false,
  // Full-face base (顔_全体): provides the natural brows + skin; the overlay
  // eyes/mouth below sit on top and cover the baked features when animating.
  face: { url: `${M}/face.png`, anchor: mFace, z: mZ.face },
  bangs: { url: `${M}/bangs.png`, anchor: mFace, z: mZ.bangs },
  eyeBg: [
    { url: `${M}/eye_white_right.png`, anchor: mFace, z: mZ.eyeWhite },
    { url: `${M}/eye_white_left.png`, anchor: mFace, z: mZ.eyeWhite },
  ],
  eyeballLeft: { url: `${M}/eyeball_left.png`, anchor: mFace, z: mZ.eyeball },
  eyeballRight: { url: `${M}/eyeball_right.png`, anchor: mFace, z: mZ.eyeball },
  blink: {
    // Legacy 4-slot mapping (kept for the animator's fallback path); the smooth
    // descent below supersedes it via closeFrames.
    frames: {
      open: `${M}/blink_1.png`,
      openToClose: `${M}/blink_3.png`,
      close: `${M}/blink_5.png`,
      closeToOpen: `${M}/blink_3.png`,
    },
    // Full lid descent 1 -> 5 then back. blink_1 (most-open) is included as the
    // first frame so the eye eases shut from open instead of snapping to a
    // half-closed lid; the animator plays 1->2->3->4->5->4->3->2->1.
    closeFrames: [
      `${M}/blink_1.png`,
      `${M}/blink_2.png`,
      `${M}/blink_3.png`,
      `${M}/blink_4.png`,
      `${M}/blink_5.png`,
    ],
    // Keep the live eye visible under the lid: the lid sits on the top layer
    // (mZ.blink) and covers the closed eye fully.
    keepEyeBgDuringBlink: true,
    anchor: mFace,
    z: mZ.blink,
  },
  eyebrows: {
    left: { url: `${M}/eyebrow_left.png`, anchor: mFace, z: mZ.eyebrow },
    right: { url: `${M}/eyebrow_right.png`, anchor: mFace, z: mZ.eyebrow },
  },
  mouth: {
    cycle: Array.from({ length: 10 }, (_, i) => `${M}/mouth_${String(i).padStart(2, "0")}.png`),
    silentClosed: `${M}/mouth_00.png`,
    silentOpen: `${M}/mouth_01.png`,
    // Full-face backdrop: besides covering the baked-in mouth during cycle
    // mid-fades, it also overlays natural eyes on top of the raw eye_white +
    // eyeball layers. Do NOT swap this for a mouth-only sprite - that exposes
    // the raw eyes ("googly eyes").
    backdrop: `${M}/mouth_backdrop.png`,
    anchor: mFace,
    z: mZ.mouth,
    zSilent: mZ.mouthSilent,
    zBackdrop: mZ.mouthBackdrop,
    // Mirror the female's cross-fade FEEL, scaled for the denser cycle. The
    // female fades a frame in over ~83% of her 0.12s frame interval (rate 10).
    // The male cycle is ~2x denser so its interval is halved to 0.06s; to keep
    // the same fade-fraction-per-frame the rates are doubled (10->20, 15->30).
    // Same per-frame blend as the female, just over smaller (interpolated) shape
    // deltas, so it reads as her natural motion (2026-07-02).
    // Softened 16/24 -> 11/17 (2026-07-03) to lengthen the frame overlap for a
    // touch more motion-blur smear on the photoreal mouth. The amplitude
    // min-frame gate (0.13s) caps the swap rate, so the slower fade blends
    // rather than piling frames into ghosting.
    fadeInRate: 11,
    fadeOutRate: 17,
    frameTime: 0.06,
    // The male backdrop (mouth_backdrop.png) is a full face with NO mouth (it
    // covers the raw eyes). Close the mouth fast at sentence end so the cycle
    // fade-out and this fade-in cross over without exposing the mouthless
    // backdrop (the "no mouth" flash). Female's backdrop has a mouth -> she
    // keeps the slow ease.
    silentCloseRate: 30,
    // Amplitude-driven: the frame index tracks the audio envelope so the mouth
    // opening matches the sound, and silence -> frame 0 (closed) with no
    // end-of-utterance flash.
    mode: "amplitude",
  },
};

export const CHARACTERS: Record<"female" | "male", CharacterConfig> = {
  female: FEMALE,
  male: MALE,
};
