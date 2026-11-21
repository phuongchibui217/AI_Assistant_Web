"use client";

import { useEffect, useRef, useState } from "react";

import { LAYOUT_H, LAYOUT_W } from "@/lib/avatar/positions";

/**
 * Calibration helper: overlays a reference image so the live sprite positions
 * can be eyeballed against a known-good composite. Used in two ways:
 *   - female: the legacy `avatar_Base.png` character composite (key O)
 *   - male:   `ref.png`, a full-interface design reference (key P)
 *
 * The image is fit `contain` into the viewport (same as Three's fitToCanvas)
 * and is independently scalable/movable as a layout guide.
 *
 * Keys (focus must be outside text inputs; transform keys act only while the
 * overlay is on, so two instances with different toggle keys don't clash):
 *   <toggleKey>  toggle overlay on/off
 *   [ / ]        opacity -/+ 10%
 *   - / =        scale -/+ 5%
 *   Arrow keys   pan 5 px (Shift = 1 px fine, Alt = 20 px coarse)
 *   R            reset to defaults
 *
 * Dev only - production builds render nothing unless loaded with `?cal=1`.
 */
type CalibrationOverlayProps = {
  src?: string;
  toggleKey?: string;
  defaultDx?: number;
  defaultDy?: number;
  defaultScale?: number;
  defaultOpacity?: number;
};

export function CalibrationOverlay({
  src = "/avatar/avatar_Base.png",
  // Default tuned 2026-05-29 for the female avatar_Base.png reference.
  toggleKey = "o",
  defaultDx = 0,
  defaultDy = -45,
  defaultScale = 1.0,
  defaultOpacity = 0.5,
}: CalibrationOverlayProps = {}) {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(defaultOpacity);
  const [scale, setScale] = useState(defaultScale);
  const [dx, setDx] = useState(defaultDx);
  const [dy, setDy] = useState(defaultDy);

  // Dev-only by default; `?cal=1` enables it against deployed builds.
  const [calibrationAllowed, setCalibrationAllowed] = useState(false);
  useEffect(() => {
    const cal = new URLSearchParams(window.location.search).get("cal") === "1";
    setCalibrationAllowed(process.env.NODE_ENV !== "production" || cal);
  }, []);

  // Transform keys only act while this overlay is on, so multiple instances
  // (female O + male P) don't both pan when arrows are pressed.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const tk = toggleKey.toLowerCase();

  useEffect(() => {
    if (!calibrationAllowed) return;
    const handle = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key.toLowerCase() === tk) {
        setEnabled((v) => !v);
        return;
      }
      if (!enabledRef.current) return;
      switch (e.key) {
        case "[":
          setOpacity((v) => Math.max(0.05, +(v - 0.1).toFixed(2)));
          break;
        case "]":
          setOpacity((v) => Math.min(1, +(v + 0.1).toFixed(2)));
          break;
        case "-":
          setScale((v) => Math.max(0.2, +(v - 0.05).toFixed(2)));
          break;
        case "=":
        case "+":
          setScale((v) => Math.min(3, +(v + 0.05).toFixed(2)));
          break;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          const step = e.shiftKey ? 1 : e.altKey ? 20 : 5;
          if (e.key === "ArrowLeft") setDx((v) => v - step);
          else if (e.key === "ArrowRight") setDx((v) => v + step);
          else if (e.key === "ArrowUp") setDy((v) => v - step);
          else setDy((v) => v + step);
          e.preventDefault();
          break;
        }
        case "r":
        case "R":
          setOpacity(defaultOpacity);
          setScale(defaultScale);
          setDx(defaultDx);
          setDy(defaultDy);
          break;
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [calibrationAllowed, tk, defaultOpacity, defaultScale, defaultDx, defaultDy]);

  if (!calibrationAllowed || !enabled) return null;

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ zIndex: 50 }}
      >
        {/* Dev-only static overlay; next/image would add SSR cost for no benefit. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          aria-hidden
          className="select-none"
          style={{
            opacity,
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            transformOrigin: "center center",
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
      <CalibrationHud
        toggleKey={toggleKey}
        opacity={opacity}
        scale={scale}
        dx={dx}
        dy={dy}
      />
    </>
  );
}

function CalibrationHud({
  toggleKey,
  opacity,
  scale,
  dx,
  dy,
}: {
  toggleKey: string;
  opacity: number;
  scale: number;
  dx: number;
  dy: number;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const layoutScale =
    size.w === 0 ? 0 : Math.min(size.w / LAYOUT_W, size.h / LAYOUT_H);
  const layoutPxW = Math.round(LAYOUT_W * layoutScale);
  const layoutPxH = Math.round(LAYOUT_H * layoutScale);

  return (
    <div
      className="pointer-events-none absolute left-4 top-4 rounded bg-black/80 px-3 py-2 font-mono text-[11px] leading-tight text-white"
      style={{ zIndex: 51 }}
    >
      <div>overlay  {toggleKey.toUpperCase()} toggle | R reset</div>
      <div>opacity {Math.round(opacity * 100)}%  [ / ]</div>
      <div>scale   {scale.toFixed(2)}    - / =</div>
      <div>offset  ({dx}, {dy})  arrows (Shift=1 Alt=20)</div>
      <div className="mt-1 border-t border-white/20 pt-1 text-white/70">
        viewport     {size.w} x {size.h}
      </div>
      <div className="text-white/70">
        layout box   {layoutPxW} x {layoutPxH}  (= 1536x1024 fit)
      </div>
      <div className="text-white/70">
        layout scale {layoutScale.toFixed(3)} px/unit
      </div>
    </div>
  );
}
