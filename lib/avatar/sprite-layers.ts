/**
 * Sprite asset paths + layer ordering for the Fujisaki avatar.
 *
 * Paths are resolved against `/avatar/...` (served from `public/avatar/`).
 * Z order goes back-to-front: smaller index = drawn behind.
 *
 * Layout based on Unity scene at `Assets/WiseP/Resources/AIAvatarLW/FujisakiSprite/`.
 */

const ROOT = "/avatar";
const MOUTH_VER = "v=10";

export const STATIC_LAYERS = {
  body: `${ROOT}/Body_700.png`,
  armLeft: `${ROOT}/Arm_Left_700.png`,
  armRight: `${ROOT}/Arm_Right_700.png`,
  neck: `${ROOT}/Neck_400.png`,
  face: `${ROOT}/Face_512.png?${MOUTH_VER}`,
  bangs: `${ROOT}/Bangs_512.png`,
  eyeBase: `${ROOT}/Eye/Eye_Base.png`,
  eyeWhite: `${ROOT}/Eye/Eye_White.png`,
  eyeWhiteShadow: `${ROOT}/Eye/Eye_WhiteShadow.png`,
  eyeballLeft: `${ROOT}/Eye/Eyeball_Left.png`,
  eyeballRight: `${ROOT}/Eye/Eyeball_Right.png`,
  eyebrowLeft: `${ROOT}/EyeBrows/Eyebrow_Left.png`,
  eyebrowRight: `${ROOT}/EyeBrows/Eyebrow_Right.png`,
} as const;

/**
 * 6 distinct speaking mouth shapes used ONLY during active speech:
 *   0: Mouth_00 = temporary closed lips (no smile lines, for short pauses)
 *   1: Mouth_01 = barely parted lips
 *   2: Mouth_02 = natural "E" shape
 *   3: Mouth_03 = rounded "O" shape (from Sheet 1)
 *   4: Mouth_04 = medium open speaking shape
 *   5: Mouth_05 = polite open "A" shape (not exaggerated)
 * While fully silent, Mouth_Close_00 (100% original base smile) is displayed.
 */
export const MOUTH_CYCLE_FRAMES: readonly string[] = [
  `${ROOT}/MouthAndJaw/Mouth_00.png?${MOUTH_VER}`,
  `${ROOT}/MouthAndJaw/Mouth_01.png?${MOUTH_VER}`,
  `${ROOT}/MouthAndJaw/Mouth_02.png?${MOUTH_VER}`,
  `${ROOT}/MouthAndJaw/Mouth_03.png?${MOUTH_VER}`,
  `${ROOT}/MouthAndJaw/Mouth_04.png?${MOUTH_VER}`,
  `${ROOT}/MouthAndJaw/Mouth_05.png?${MOUTH_VER}`,
];

/** Mouthless skin backdrop behind speaking cycle frames so closed lips never peek through. */
export const MOUTH_BACKDROP = `${ROOT}/MouthAndJaw/Mouth_Backdrop.png?${MOUTH_VER}`;
/** Held while the avatar is fully silent (no voice in flight). */
export const MOUTH_SILENT_CLOSED = `${ROOT}/MouthAndJaw/Mouth_Close_00.png?${MOUTH_VER}`;
/** Held during a brief silence inside a speaking turn. */
export const MOUTH_SILENT_OPEN = `${ROOT}/MouthAndJaw/Mouth_Open_00.png?${MOUTH_VER}`;

/**
 * Blink animation: Open -> OpenToClose -> Close -> CloseToOpen -> Open
 * The last `Half` frame is used as a slow-mode rest position.
 */
export const BLINK_FRAMES = {
  open: `${ROOT}/EyeBlink/Eye_Open.png`,
  openToClose: `${ROOT}/EyeBlink/Eye_OpenToClose.png`,
  close: `${ROOT}/EyeBlink/Eye_Close.png`,
  closeToOpen: `${ROOT}/EyeBlink/Eye_CloseToOpen.png`,
  half: `${ROOT}/EyeBlink/Eye_Harlf.png`,
} as const;

export type StaticLayerKey = keyof typeof STATIC_LAYERS;
export type BlinkFrameKey = keyof typeof BLINK_FRAMES;

/** All sprite URLs we need to preload before showing the avatar. */
export function allSpriteUrls(): string[] {
  return [
    ...Object.values(STATIC_LAYERS),
    ...MOUTH_CYCLE_FRAMES,
    MOUTH_SILENT_CLOSED,
    MOUTH_SILENT_OPEN,
    ...Object.values(BLINK_FRAMES),
  ];
}
