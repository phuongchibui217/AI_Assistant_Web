/**
 * Sprite placement constants ported from the Unity scene. Positions are in
 * Pixi/Unity-image coordinate space (origin top-left, Y-down) within a
 * nominal 1536x1024 layout canvas. `pixiToThree` converts to Three.js world
 * coords (origin centre, Y-up) so sprites render at the same relative offsets
 * as the Unity build.
 *
 * Each face-area sprite (face, eye trio, blink frames, mouth frames) has its
 * own anchor entry. Defaults are all set to the head centre because the new
 * Fujisaki face-area textures are pre-aligned inside their own 512x512
 * canvas, so they line up when sharing a single anchor - but you can offset
 * any individual layer here without touching the scene graph.
 */

export const LAYOUT_W = 1536;
export const LAYOUT_H = 1024;

export function pixiToThree(px: number, py: number): [number, number] {
  return [px - LAYOUT_W / 2, LAYOUT_H / 2 - py];
}

/**
 * Vertical anchor for the head block. Move the whole face down by raising
 * this number (Pixi Y is top-down).
 *
 * Note: legacy demo used head Y=232 with a different body sprite whose
 * shoulders sat higher. The new Fujisaki Body_700 has its collar lower, so
 * we drop the head by ~50-150 px depending on body Y.
 */
const HEAD_Y = 240;
const HEAD_X = 776;

/** Convenience constant - lets you tune the whole face block at once. */
const HEAD = { x: HEAD_X, y: HEAD_Y };

/**
 * Pixi-space sprite anchors.
 *
 * All female face-area sprites (face, bangs, eyes, eyeballs, eyebrows, blink,
 * mouth) are pre-aligned 1:1 in the same 512x512 canvas cropped directly from
 * `avatar_Base.png`, so every face layer shares `HEAD`. Body is cropped 1:1
 * from `avatar_Base.png` (700x700) with natural arms baked in (matching MALE).
 */
export const POS = {
  // ----- Body block (700x700 @ [420..1120, 324..1024] in 1536x1024) -----
  body: { x: 770, y: 674 },
  armLeft: { x: 770, y: 674 },
  armRight: { x: 770, y: 674 },
  // Head-sway pivot centred on the burgundy choker.
  neck: { x: 776, y: 376 },

  // ----- Head + face-area (all 512x512 pre-aligned at HEAD) -----
  head: HEAD,
  face: HEAD,
  bangs: HEAD,
  eyeBase: HEAD,
  eyeWhite: HEAD,
  eyeWhiteShadow: HEAD,
  blink: HEAD,
  mouth: HEAD,
  mouthSilent: HEAD,
  eyebrowLeft: HEAD,
  eyebrowRight: HEAD,
  eyeballLeft: HEAD,
  eyeballRight: HEAD,
} as const;

/** Z-order back to front. Larger = closer to camera. */
export const Z = {
  neck: 0.01,
  // Face sits behind body (0.02 < 0.05) so the burgundy choker and draped hair
  // lock on Body_700 cleanly cover the lower neck during head sway (like MALE).
  face: 0.02,
  body: 0.05,
  armRight: 0.11,
  armLeft: 0.12,
  // Eye stack bottom->top: sclera white, its shadow, the moving iris, then the
  // eyeliner/lid rim (eyeBase) ON TOP so the iris tucks under the lids instead
  // of floating over the whole eye.
  eyeWhite: 0.12,
  eyeWhiteShadow: 0.13,
  eyeball: 0.14,
  eyeBase: 0.15,
  blink: 0.8,
  eyebrow: 0.85,
  // Front bangs strand over the outer viewer-right brow so brow raises tuck
  // naturally behind the hair.
  bangs: 0.86,
  // `mouthSilentBackdrop` is the always-visible "neutral closed lips" base
  // layer (uses MOUTH_SILENT_CLOSED). It sits BELOW the cycle frames so the
  // baked-in mouth on Face_512.png never peeks through when cycle frames
  // fade at speech start/end. Cycle z=0.9 / silentOpen z=0.95 stay above.
  mouthSilentBackdrop: 0.87,
  mouth: 0.9,
  mouthSilent: 0.95,
} as const;
