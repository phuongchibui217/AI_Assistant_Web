import * as THREE from "three";

/**
 * Three.js scene + camera + renderer scaffold for the 2D sprite avatar.
 *
 * Uses an orthographic camera so sprites stay pixel-perfect regardless of
 * canvas resize. World units are pixels; (0, 0) is centre.
 */
export class AvatarRenderer {
  private readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  /**
   * Root group where avatar sprites are mounted. Animators may transform this
   * group (e.g. lateral sway) without touching the camera.
   */
  readonly root: THREE.Group;

  private rafId: number | null = null;
  private lastFrameTime = 0;
  private readonly tickers: Array<(dt: number) => void> = [];

  // Dev calibration zoom: narrows the camera frustum around a focus point so a
  // small region (an eye, the chin) fills the canvas. zoom=1 = normal, centred.
  private zoom = 1;
  private zoomCx = 0;
  private zoomCy = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    const { clientWidth: w, clientHeight: h } = canvas;
    this.camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
    this.camera.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);
    this.renderer.clear();

    this.root = new THREE.Group();
    this.scene.add(this.root);
  }

  /** Register a per-frame callback. Called with delta time in seconds. */
  addTicker(fn: (dt: number) => void): void {
    this.tickers.push(fn);
  }

  /**
   * Resize the renderer + camera frustum to match the canvas container.
   * Call on window resize or layout changes.
   */
  resize(): void {
    this.applyCameraFrustum();
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setSize(w, h, false);
  }

  /**
   * Dev calibration zoom. factor=1 resets to the normal centred view; >1 zooms
   * into world point (cx, cy). Persists across resizes.
   */
  setZoom(factor: number, cx: number, cy: number): void {
    this.zoom = Math.max(1, factor);
    this.zoomCx = cx;
    this.zoomCy = cy;
    this.applyCameraFrustum();
  }

  private applyCameraFrustum(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const halfW = w / 2 / this.zoom;
    const halfH = h / 2 / this.zoom;
    const cx = this.zoom === 1 ? 0 : this.zoomCx;
    const cy = this.zoom === 1 ? 0 : this.zoomCy;
    this.camera.left = cx - halfW;
    this.camera.right = cx + halfW;
    this.camera.top = cy + halfH;
    this.camera.bottom = cy - halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Start the render loop. Idempotent. */
  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    // Paint frame 0 synchronously so revealing the canvas on "ready" never
    // flashes an empty or stale buffer before the first rAF tick.
    this.renderer.render(this.scene, this.camera);
    const tick = (now: number) => {
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;
      for (const fn of this.tickers) fn(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // Wipe the framebuffer transparent before releasing WebGL state so a
    // character switch never leaves stale/clipped pixels of the previous avatar.
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        obj.geometry?.dispose?.();
        const mat = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }
}

/**
 * Preload sprite textures so first-frame rendering never flashes empty.
 * Returns a map keyed by the URL exactly as passed in.
 */
export async function loadTextures(
  urls: readonly string[],
): Promise<Map<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  const loadOne = (url: string): Promise<[string, THREE.Texture]> =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          resolve([url, tex]);
        },
        undefined,
        (err) => reject(err),
      );
    });

  const entries = await Promise.all(urls.map(loadOne));
  return new Map(entries);
}

/**
 * Build a sprite plane sized to the texture's natural dimensions, centred at
 * the origin. The returned mesh uses a PlaneGeometry + MeshBasicMaterial so
 * we can animate alpha cleanly (more control than THREE.Sprite).
 */
export type SpriteBounds = readonly [left: number, top: number, right: number, bottom: number];

export function makeSpritePlane(
  texture: THREE.Texture,
  z: number,
  bounds?: SpriteBounds,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const img = texture.image as HTMLImageElement | undefined;
  const w = img?.naturalWidth ?? 512;
  const h = img?.naturalHeight ?? 512;
  const [left, top, right, bottom] = bounds ?? [0, 0, w, h];
  const regionWidth = right - left;
  const regionHeight = bottom - top;
  const geometry = new THREE.PlaneGeometry(regionWidth, regionHeight);
  if (bounds) {
    // Crop fully transparent margins while retaining placement on the authored
    // canvas. Artwork, calibration anchors and layer order stay aligned.
    geometry.translate((left + right - w) / 2, (h - top - bottom) / 2, 0);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (left + uv.getX(i) * regionWidth) / w, (h - bottom + uv.getY(i) * regionHeight) / h);
    }
  }
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

/** Restrict animated mouth layers to the lips, feathering out their upper edge. */
export function makeMouthFeather(height: number, start: number, end: number): THREE.DataTexture {
  const pixels = new Uint8Array(height * 4);
  for (let row = 0; row < height; row++) {
    // Sprite coordinates count down from the top, while the texture's UV counts up.
    const opacity = THREE.MathUtils.smoothstep(height - row - 0.5, start, end);
    pixels.fill(Math.round(opacity * 255), row * 4, row * 4 + 4);
  }
  const texture = new THREE.DataTexture(pixels, 1, height);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
