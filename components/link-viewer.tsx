"use client";

import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  url: string;
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;
const MARGIN = 16; // keeps the panel from being dragged fully off-screen

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const CURSOR: Record<Edge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

function defaultRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(1100, vw * 0.7);
  const height = Math.min(800, vh * 0.85);
  return {
    width,
    height,
    top: (vh - height) / 2,
    // Right-anchored like the old sm:justify-end sm:pr-8 layout.
    left: Math.max(MARGIN, vw - width - 32),
  };
}

function clampRect(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(r.width, MIN_WIDTH), vw - MARGIN * 2);
  const height = Math.min(Math.max(r.height, MIN_HEIGHT), vh - MARGIN * 2);
  const left = Math.min(Math.max(r.left, MARGIN), vw - width - MARGIN);
  const top = Math.min(Math.max(r.top, MARGIN), vh - height - MARGIN);
  return { top, left, width, height };
}

/**
 * Same fixed-overlay-with-iframe pattern as `CitationViewer` (no new tab, so
 * the Gemini audio session keeps running), but for an arbitrary external URL
 * found in an answer's text instead of a KB citation file.
 *
 * Freely resizable by dragging any edge or corner (client spec 2026-07-30 -
 * the native CSS `resize` property only offers a single bottom-right-corner
 * grip, not what was asked for), plus a maximize/restore shortcut.
 *
 * Many real sites refuse to be framed (`X-Frame-Options`/CSP
 * `frame-ancestors`) and there is no reliable cross-origin way to detect
 * that from inside the page - it just renders blank. The "open in new tab"
 * button is the deliberate fallback for that case, always shown rather than
 * conditionally, since we can't tell in advance which sites will block us.
 */
export function LinkViewer({ url, onClose }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [maximized, setMaximized] = useState(false);
  // Rect to restore to when un-maximizing - the rect the user last resized/
  // dragged to, not necessarily the initial default.
  const preMaximizeRect = useRef<Rect | null>(null);
  const dragRef = useRef<{ edge: Edge; startRect: Rect; startX: number; startY: number } | null>(null);

  useEffect(() => {
    setRect(defaultRect());
  }, []);

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Malformed URL slipped through the linkify regex - fall back to showing
    // it verbatim rather than crashing on `new URL()`.
  }

  // Same history-integration pattern as CitationViewer: the mobile back
  // gesture closes the viewer instead of leaving the SPA.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ linkViewer: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const requestClose = useCallback(() => window.history.back(), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestClose]);

  const toggleMaximize = () => {
    if (maximized) {
      setRect(preMaximizeRect.current ?? defaultRect());
      setMaximized(false);
    } else {
      preMaximizeRect.current = rect;
      setRect({
        top: MARGIN,
        left: MARGIN,
        width: window.innerWidth - MARGIN * 2,
        height: window.innerHeight - MARGIN * 2,
      });
      setMaximized(true);
    }
  };

  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    if (maximized || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { edge, startRect: rect, startX: e.clientX, startY: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const { edge, startRect: s } = drag;
    const next: Rect = { ...s };
    if (edge.includes("e")) next.width = s.width + dx;
    if (edge.includes("w")) {
      next.width = s.width - dx;
      next.left = s.left + dx;
    }
    if (edge.includes("s")) next.height = s.height + dy;
    if (edge.includes("n")) {
      next.height = s.height - dy;
      next.top = s.top + dy;
    }
    // Re-derive left/top from the fixed opposite edge after clamping width/
    // height, so a drag that hits the min size doesn't yank the opposite
    // edge along with it.
    if (edge.includes("w") && next.width < MIN_WIDTH) next.left = s.left + s.width - MIN_WIDTH;
    if (edge.includes("n") && next.height < MIN_HEIGHT) next.top = s.top + s.height - MIN_HEIGHT;
    setRect(clampRect(next));
  };

  const endResize = () => {
    dragRef.current = null;
  };

  if (!rect) return null;

  const handles: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onClick={requestClose}
      onPointerMove={onResizeMove}
      onPointerUp={endResize}
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Resize handles (skipped while maximized) ── */}
        {!maximized &&
          handles.map((edge) => (
            <div
              key={edge}
              onPointerDown={startResize(edge)}
              className={cn(
                "absolute z-10",
                edge === "n" && "inset-x-2 top-0 h-1.5",
                edge === "s" && "inset-x-2 bottom-0 h-1.5",
                edge === "e" && "inset-y-2 right-0 w-1.5",
                edge === "w" && "inset-y-2 left-0 w-1.5",
                edge === "ne" && "right-0 top-0 h-3 w-3",
                edge === "nw" && "left-0 top-0 h-3 w-3",
                edge === "se" && "right-0 bottom-0 h-3 w-3",
                edge === "sw" && "left-0 bottom-0 h-3 w-3",
              )}
              style={{ cursor: CURSOR[edge], touchAction: "none" }}
            />
          ))}

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-gray-100 px-4 py-2">
          <span className="flex-1 truncate text-sm font-medium text-gray-800">
            {hostname}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open in new tab"
            title="Open in new tab"
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={toggleMaximize}
            aria-label={maximized ? "Restore" : "Maximize"}
            title={maximized ? "Restore" : "Maximize"}
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
          >
            {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            title="Close"
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-auto bg-gray-50">
          <iframe src={url} title={hostname} className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
}
