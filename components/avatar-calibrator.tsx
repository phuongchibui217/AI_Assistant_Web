"use client";

import { useEffect, useRef, useState } from "react";

import type { Avatar } from "@/lib/avatar/avatar";

/**
 * Dev calibration panel for nudging individual avatar sprite layers pixel by
 * pixel (issue 2 white-seam fix + male-avatar layout calibration). Toggle with
 * `k`; select a layer (click a row or press 1-9); nudge with W/A/S/D (1 px),
 * hold Shift for 0.25 px fine steps. Q/E shift the selected layer's draw order
 * (z) back/front by 0.01 (Shift = 0.001) so the stacking order can be tried
 * live. Press `z` to cycle a camera zoom focused on the selected layer so small
 * seams are visible on a laptop screen. The panel shows each layer's live Pixi
 * anchor + z to paste into `lib/avatar/characters.ts`.
 *
 * Dev only: inert in production unless the page is loaded with `?cal=1`
 * (same gate as CalibrationOverlay).
 */
const ZOOM_STEPS = [1, 2, 4, 6];

export function AvatarCalibrator({ avatar }: { avatar: Avatar | null }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [layers, setLayers] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [zoom, setZoom] = useState(1);
  // When on, WASD moves the WHOLE avatar instead of the selected layer.
  const [groupMode, setGroupMode] = useState(false);
  // Bumped after every nudge so the read-out re-renders with fresh anchors.
  const [, setTick] = useState(0);

  useEffect(() => {
    const cal = new URLSearchParams(window.location.search).get("cal") === "1";
    setAllowed(process.env.NODE_ENV !== "production" || cal);
  }, []);

  useEffect(() => {
    if (avatar) setLayers(avatar.calLayerNames());
  }, [avatar]);

  // Reset the zoom whenever the panel closes so the demo view is never left
  // zoomed in.
  useEffect(() => {
    if (!open && avatar) {
      setZoom(1);
      avatar.setCalZoom(null, 1);
    }
  }, [open, avatar]);

  // Refs so the one-time keydown listener always sees current state.
  const openRef = useRef(open);
  openRef.current = open;
  const selRef = useRef(sel);
  selRef.current = sel;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const groupModeRef = useRef(groupMode);
  groupModeRef.current = groupMode;

  const focus = (idx: number, z: number) => {
    if (!avatar) return;
    avatar.setCalZoom(z > 1 ? layersRef.current[idx] : null, z);
  };

  const select = (idx: number) => {
    setSel(idx);
    focus(idx, zoomRef.current);
  };

  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "k" || e.key === "K") {
        setOpen((v) => !v);
        return;
      }
      if (!openRef.current || !avatar) return;

      const names = layersRef.current;
      if (names.length === 0) return;

      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        if (idx < names.length) select(idx);
        return;
      }

      if (e.key === "z" || e.key === "Z") {
        const cur = zoomRef.current;
        const next =
          ZOOM_STEPS[(ZOOM_STEPS.indexOf(cur) + 1) % ZOOM_STEPS.length];
        setZoom(next);
        focus(selRef.current, next);
        e.preventDefault();
        return;
      }

      if (e.key === "g" || e.key === "G") {
        setGroupMode((v) => !v);
        e.preventDefault();
        return;
      }

      const step = e.shiftKey ? 0.25 : 1;
      const zStep = e.shiftKey ? 0.001 : 0.01;
      const name = names[selRef.current];
      // Group mode only changes what WASD moves (whole avatar vs selected
      // layer). Q/E z-order, R (reset root), and selection all stay live so the
      // panel never traps the user in a mode where most keys appear dead.
      const grp = groupModeRef.current;
      let moved = true;
      switch (e.key.toLowerCase()) {
        case "w":
          if (grp) avatar.nudgeRoot(0, -step);
          else avatar.nudgeCalLayer(name, 0, -step);
          break;
        case "s":
          if (grp) avatar.nudgeRoot(0, step);
          else avatar.nudgeCalLayer(name, 0, step);
          break;
        case "a":
          if (grp) avatar.nudgeRoot(-step, 0);
          else avatar.nudgeCalLayer(name, -step, 0);
          break;
        case "d":
          if (grp) avatar.nudgeRoot(step, 0);
          else avatar.nudgeCalLayer(name, step, 0);
          break;
        case "e":
          avatar.bumpCalLayerZ(name, zStep);
          break;
        case "q":
          avatar.bumpCalLayerZ(name, -zStep);
          break;
        case "r":
          if (grp) avatar.resetRoot();
          else moved = false;
          break;
        default:
          moved = false;
      }
      if (moved) {
        e.preventDefault();
        setTick((t) => t + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `avatar` is the only external dep; select/focus close over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, avatar]);

  if (!allowed || !open) return null;

  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));
  const zfmt = (n: number) => n.toFixed(3);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-40 w-72 rounded bg-black/85 p-3 font-mono text-[11px] leading-tight text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between font-bold">
        <span>Avatar Calibrator</span>
        <span className="font-normal text-white/50">zoom {zoom}x · k=hide</span>
      </div>
      <div className="mb-2 text-white/60">
        WASD nudge 1px (Shift=0.25). Q/E z-order back/front 0.01 (Shift=0.001).
        z=zoom. G=move whole avatar. Click / 1-9 select. Paste x,y,z into
        characters.ts.
      </div>
      <button
        onClick={() => setGroupMode((v) => !v)}
        className={`mb-2 flex w-full items-center justify-between rounded px-1.5 py-1 text-left ${
          groupMode ? "bg-sky-600/80" : "hover:bg-white/10"
        }`}
      >
        <span>
          <span className="text-white/40">G.</span> WHOLE AVATAR
        </span>
        {groupMode && avatar && (
          <span className="shrink-0 tabular-nums text-white/80">
            {(() => {
              const o = avatar.rootOffsetValue();
              return `${fmt(o.x)},${fmt(o.y)} · WASD R=reset`;
            })()}
          </span>
        )}
      </button>
      <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
        {layers.map((name, i) => {
          const a = avatar?.calLayerAnchor(name);
          const active = i === sel;
          return (
            <button
              key={name}
              onClick={() => select(i)}
              className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left ${
                active ? "bg-emerald-600/80" : "hover:bg-white/10"
              }`}
            >
              <span className="truncate">
                <span className="text-white/40">{i + 1}.</span> {name}
              </span>
              {a && (
                <span className="shrink-0 tabular-nums text-white/80">
                  {fmt(a.x)},{fmt(a.y)}
                  {(a.dx !== 0 || a.dy !== 0) && (
                    <span className="text-amber-400">
                      {" "}
                      ({a.dx >= 0 ? "+" : ""}
                      {fmt(a.dx)},{a.dy >= 0 ? "+" : ""}
                      {fmt(a.dy)})
                    </span>
                  )}
                  <span className="text-sky-400"> z{zfmt(a.z)}</span>
                  {Math.abs(a.dz) > 0.0005 && (
                    <span className="text-amber-400">
                      ({a.dz >= 0 ? "+" : ""}
                      {zfmt(a.dz)})
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
