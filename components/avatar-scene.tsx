"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/lib/avatar/avatar";
import { FEMALE, type CharacterConfig } from "@/lib/avatar/characters";

type Status = "loading" | "ready" | "error";

type AvatarSceneProps = {
  /** Fires once the avatar finishes loading. Parent wires audio + talk callbacks. */
  onReady?: (avatar: Avatar) => void;
  /** Which character sprite set to build. Changing it rebuilds the avatar. */
  config?: CharacterConfig;
};

/**
 * Mounts a WebGL canvas and instantiates the Avatar facade. Once the avatar
 * is ready it fires `onReady(avatar)` so the parent can attach the playback
 * analyser for lip-sync and call talk-start/end on session events.
 *
 * Owns no audio or session state - this component is purely visual.
 */
export function AvatarScene({ onReady, config = FEMALE }: AvatarSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setStatus("loading");
    const avatar = new Avatar(canvas, config);
    avatarRef.current = avatar;

    avatar
      .load()
      .then(() => {
        if (cancelled) return;
        // Container may have settled (or scrollbars appeared) during async
        // texture load - re-sync camera frustum + drawingBuffer to the
        // current canvas size before first render.
        avatar.resize();
        avatar.start();
        setStatus("ready");
        onReady?.(avatar);
      })
      .catch((err: unknown) => {
        console.error("[AvatarScene] load failed:", err);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });

    // Window resize is not enough - the canvas container can change size from
    // sidebar/panel toggles, mobile keyboard, scrollbar shifts, etc. without
    // firing a window resize. ResizeObserver catches both window AND container
    // changes so the camera frustum stays locked to the canvas CSS box and the
    // avatar doesn't stretch.
    const onResize = () => avatar.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      avatar.dispose();
      avatarRef.current = null;
    };
    // Rebuild when the character config changes (gender toggle). onReady is
    // intentionally excluded - parents pass a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${status === "ready" ? "opacity-100" : "opacity-0"}`}
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
          Loading avatar...
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-sm text-red-300">
          Avatar failed to load: {error}
        </div>
      )}
    </div>
  );
}
