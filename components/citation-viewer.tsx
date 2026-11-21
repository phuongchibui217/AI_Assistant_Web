"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/use-is-mobile";

type Props = {
  filename: string;
  onClose: () => void;
};

/**
 * Full-screen fixed overlay that loads a citation file (PDF, HTML, image, etc.)
 * inside an iframe / img. Uses `position: fixed` so it overlays the full viewport
 * regardless of where it is mounted in the DOM.
 *
 * Critically, this does NOT open a new tab — so the browser never fires
 * `window.blur`, which means the Gemini audio session keeps running uninterrupted
 * while the user reads a citation.
 */
type PageDim = { w: number; h: number };

export function CitationViewer({ filename, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isMobile = useIsMobile();

  // HTML files are served through a server-side proxy (/api/file-content)
  // that injects <base target="_blank"> so all links open in a new tab
  // instead of navigating within the popup iframe (feedback: external links
  // should not redirect inside the popup).
  const isHtml = /\.html?$/i.test(filename);
  // Plain-text files (.txt/.md/...) must also go through the /api/file-content
  // proxy, not a direct GCS URL: the raw file carries no charset, so an iframe
  // loading it lets the browser guess the encoding and a UTF-8 file renders as
  // mojibake (JP guessed Shift_JIS, VN guessed Latin-1). The proxy decodes the
  // bytes and re-emits them as UTF-8. Keep this extension list in sync with the
  // `isText` branch in app/api/file-content/route.ts.
  const isText = /\.(txt|csv|md|log|json|xml|vtt|srt)$/i.test(filename);
  // PPT / Word / Excel can't render in an iframe directly, so the backend
  // converts them to PDF (cached) and we point the iframe at that proxy.
  const isOffice = /\.(pptx?|docx?|xlsx?|odt|odp|ods)$/i.test(filename);
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(filename);
  const isPdf = /\.pdf$/i.test(filename);

  // iOS Safari (WebKit) refuses to render a multi-page PDF inside an <iframe>:
  // it shows only page 1 as a static, non-scrollable, non-zoomable image and
  // ignores `#view=FitH`. That breaks every PDF/Office citation on iPhone, not
  // just one file. The robust cross-platform fix is to stop relying on the
  // browser's PDF viewer on phones and render each page to a PNG (the backend
  // already does this for the Unity client) shown as a vertical stack of <img>
  // - which scrolls and fits width natively on iOS. Desktop keeps the iframe.
  const usePageImages = isMobile && (isPdf || isOffice);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [dims, setDims] = useState<PageDim[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Page-image mode fetches page metadata in its own effect below.
    if (usePageImages) return;
    setUrl(null);
    setError(false);

    if (isHtml || isText) {
      // HTML + plain text → serve through the proxy so the response carries an
      // explicit UTF-8 charset (see isText comment above). No extra fetch needed.
      if (!cancelled) setUrl(`/api/file-content?name=${encodeURIComponent(filename)}`);
    } else if (isOffice) {
      // Office → backend converts to PDF; the browser renders it in the iframe.
      if (!cancelled) setUrl(`/api/file-preview-pdf?name=${encodeURIComponent(filename)}`);
    } else {
      fetch(`/api/file-url?name=${encodeURIComponent(filename)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`status ${r.status}`);
          return r.json() as Promise<{ url?: string }>;
        })
        .then((data) => {
          if (!cancelled) setUrl(data.url ?? null);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [filename, isHtml, isText, isOffice, usePageImages]);

  // Page-image mode: fetch the page count + per-page dimensions so we can lay
  // out one <img> per page. The dims let us reserve each page's space via
  // aspect-ratio, which keeps `loading="lazy"` honest (pages only fetch as they
  // scroll into view) and prevents layout jump as images arrive.
  useEffect(() => {
    if (!usePageImages) return;
    let cancelled = false;
    setPageCount(null);
    setDims(null);
    setError(false);
    fetch(`/api/file-pages?name=${encodeURIComponent(filename)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json() as Promise<{ pages?: number; dims?: PageDim[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setPageCount(data.pages ?? 0);
        setDims(data.dims ?? null);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filename, usePageImages]);

  // Integrate with browser history so the mobile back gesture closes the viewer
  // instead of navigating away from the SPA. Opening a fullscreen PDF, then
  // pressing the device back button (the instinctive way to dismiss it) used to
  // exit the whole app and drop the chat session. We push one history entry on
  // open; the back button (or our own X/backdrop/Escape, which call
  // history.back()) pops it and fires popstate, which closes the viewer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ citationViewer: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Single close path: pop our history entry → popstate → onClose. Used by the X
  // button, backdrop click, and Escape so all dismissals keep history balanced.
  const requestClose = useCallback(() => window.history.back(), []);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestClose]);

  return (
    /* Backdrop — click outside to close */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:items-center sm:justify-end sm:pr-8"
      onClick={requestClose}
    >
      {/* Panel — stop propagation so clicks inside don't close.
          Mobile (<768px): nearly full-screen so PDF/HTML/image citations are readable.
          Desktop (sm+): right-anchored panel preserving the original min() sizing. */}
      <div
        className="relative flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl
                   w-[96vw] h-[94dvh]
                   sm:w-[var(--panel-w)] sm:h-[var(--panel-h)]"
        style={{
          ["--panel-w" as string]: "min(60vw, 920px)",
          ["--panel-h" as string]: "min(80vh, 720px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-gray-100 px-4 py-2">
          <span className="flex-1 truncate text-sm font-medium text-gray-800">
            {filename}
          </span>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close citation"
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-auto bg-gray-50">
          {error ? (
            <div className="flex h-full items-center justify-center text-sm text-red-500">
              Could not load file.
            </div>
          ) : usePageImages ? (
            pageCount === null ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Loading…
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 p-2">
                {Array.from({ length: pageCount }, (_, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={`/api/file-page?name=${encodeURIComponent(filename)}&page=${i + 1}`}
                    alt={`${filename} page ${i + 1}`}
                    loading="lazy"
                    className="w-full rounded bg-white shadow"
                    style={dims?.[i] ? { aspectRatio: `${dims[i].w} / ${dims[i].h}` } : undefined}
                  />
                ))}
              </div>
            )
          ) : url === null ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Loading…
            </div>
          ) : isImage ? (
            <div className="flex items-start justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={filename}
                className="max-w-full rounded shadow"
                onError={() => setError(true)}
              />
            </div>
          ) : (
            <iframe
              // PDFs (direct or Office-converted) render in the browser's native
              // viewer. On a narrow phone its default zoom overflows the panel
              // width; `#view=FitH` tells the viewer to fit the page WIDTH so it
              // scrolls vertically only. HTML pages render their own layout, so
              // the fragment is skipped for them. Desktop keeps the default zoom.
              src={isMobile && !isHtml && !isText ? `${url}#view=FitH` : url}
              title={filename}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
