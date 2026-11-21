"use client";

import { Check, Copy, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ChatMessage } from "@/hooks/use-chat-messages";
import type { Citation } from "@/lib/citations";
import { CITATION_MARKER_RE } from "@/lib/markdown";
import { usePersona } from "@/hooks/use-persona";
import { cn } from "@/lib/utils";
import { CitationViewer } from "@/components/citation-viewer";
import { LinkViewer } from "@/components/link-viewer";
import { isSameSite } from "@/lib/site-match";

/**
 * Strip bracketed citation markers ([1], [2, 3, 4, 5], ［１］) from the answer
 * before display. The numbers are echoed from the grounded prompt and never
 * match the deduped reference list below, so the client asked to remove them
 * from both the text and the reference names (supersedes the earlier
 * clickable-inline-marker request #59). The reference chips stay clickable.
 */
function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER_RE, "");
}

/** True when this page is running inside a cross-origin iframe (the client's
 *  embed.js loader) - `window.top` throws/differs from `window.self`. Used to
 *  gate the citation top-navigate behavior to embedded contexts only; the
 *  standalone site should always open the in-app viewer. */
function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/**
 * Citation click on the client's own embedded site (2026-07-31 spec): if the
 * cited source is a URL from the SAME site the widget is embedded on,
 * navigate the host page there directly instead of opening the in-app
 * viewer. `window.top.location` assignment from a cross-origin iframe is
 * still permitted by browsers given a user gesture (classic "frame busting"),
 * so no postMessage channel is needed.
 *
 * Safety-critical: only navigate when `document.referrer` and the citation's
 * source URL belong to the same site (same registrable domain, subdomains
 * allowed - see `isSameSite`). Without this check, a KB citation sourced
 * from one customer's site could navigate a DIFFERENT customer's embedded
 * page to an unrelated domain. Any mismatch, non-embedded context, or missing
 * `sourceUrl` falls back to the in-app CitationViewer.
 */
export function tryNavigateToSource(citation: Citation): boolean {
  if (!citation.sourceUrl || !isEmbedded()) return false;
  try {
    const target = new URL(citation.sourceUrl);
    if (!document.referrer) return false;
    const referrer = new URL(document.referrer);
    if (!isSameSite(referrer.hostname, target.hostname)) return false;
    window.top!.location.href = citation.sourceUrl;
    return true;
  } catch {
    return false;
  }
}

/** Id of the most recently sent user message, or null if there isn't one -
 *  the only bubble editing is allowed on (see ChatPanel/MobileChat). */
export function findLastUserMessageId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].id;
  }
  return null;
}

// Captures the URL itself in a group so String.split keeps it in the output
// array (at odd indices) instead of discarding it like a plain match would.
// Excludes common wrapping/closing punctuation from the URL body so a URL
// sitting inside parens or JP brackets, or ending a sentence, doesn't pull
// the closer into the link - TRAILING_PUNCT_RE below catches anything that
// still trails after this (e.g. a "." the exclusion list didn't list).
const URL_RE = /(https?:\/\/[^\s<>"'「」『』（）()]+)/g;
const TRAILING_PUNCT_RE = /[)\]}'"，。、,.;:!?」』】》〉]+$/;

/**
 * Render answer text with bare URLs turned into clickable buttons (client
 * spec 2026-07-30) that open `LinkViewer` instead of navigating away. Plain
 * buttons, not `<a>` - same reasoning as the citation chips: an `<a target=
 * _blank>` fires `window.blur`, which would interrupt the live audio session.
 */
function linkifyText(text: string, onOpenLink?: (url: string) => void): ReactNode {
  if (!onOpenLink) return text;
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part || null;
    const trailing = part.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    if (!url) return part;
    return (
      <Fragment key={i}>
        <button
          type="button"
          onClick={() => onOpenLink(url)}
          className="break-all text-sky-700 underline hover:text-sky-900"
        >
          {url}
        </button>
        {trailing}
      </Fragment>
    );
  });
}

type ChatPanelProps = {
  messages: ChatMessage[];
  /** Called when the user clicks one of the suggested follow-up question
   *  chips. Submits the chip text as a new question. */
  onSendSuggestion?: (text: string) => void;
  /** True while a question is being processed but no answer has appeared yet.
   *  Renders an animated "thinking" bubble (feedback #45). */
  thinking?: boolean;
  /** Edit an already-sent user message (Messenger-style: hover the bubble to
   *  reveal a pencil icon, click to edit in place). Deletes the message + its
   *  reply and re-asks with the edited text. Omit to disable editing. */
  onEditMessage?: (id: string, text: string) => void;
  /** True when the avatar is hidden (admin off, or the user's own text-only
   *  toggle) - the panel widens and centers instead of hugging the left edge
   *  reserved for the avatar, so it doesn't read as off-balance on empty
   *  background (client spec 2026-07-30). */
  centered?: boolean;
  /** Live mic transcript, shown as a bubble in the conversation while the mic
   *  is held or still finishing recognition - voice input streams straight
   *  into the chat instead of the composer bar (client spec 2026-07-30). Null
   *  when not talking. */
  micPreview?: { text: string; listening: boolean } | null;
};

/**
 * Left-side overlay showing the conversation history. User bubbles sit on the
 * right; model bubbles have an avatar icon + name on the left to match the
 * Unity layout. The panel auto-scrolls to the latest message.
 */
export function ChatPanel({
  messages,
  onSendSuggestion,
  thinking,
  onEditMessage,
  centered = false,
  micPreview,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeCitation, setActiveCitation] = useState<string | null>(null);
  const [activeLink, setActiveLink] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, micPreview?.text]);

  // Only the most recently sent user message is editable - editing an older
  // one would delete/regenerate a reply buried under newer turns, which read
  // as "my current answer just vanished" (client feedback 2026-07-30).
  const lastUserMessageId = findLastUserMessageId(messages);

  return (
    <>
      <aside
        className={cn(
          "pointer-events-none absolute inset-y-0 flex flex-col p-4 pb-28",
          centered
            ? "left-1/2 w-full max-w-2xl -translate-x-1/2"
            : "left-0 w-[42vw] max-w-[640px]",
        )}
      >
        <div
          ref={scrollRef}
          className="pointer-events-auto flex flex-col gap-3 overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onSendSuggestion={onSendSuggestion}
              onViewCitation={(c) => {
                if (!tryNavigateToSource(c)) setActiveCitation(c.filename);
              }}
              onOpenLink={setActiveLink}
              onEditMessage={m.id === lastUserMessageId ? onEditMessage : undefined}
              translucent
            />
          ))}
          {thinking && <TypingIndicator translucent />}
          {micPreview && (
            <LiveMicBubble
              text={micPreview.text}
              listening={micPreview.listening}
              translucent
            />
          )}
        </div>
      </aside>

      {activeCitation && (
        <CitationViewer
          filename={activeCitation}
          onClose={() => setActiveCitation(null)}
        />
      )}
      {activeLink && (
        <LinkViewer url={activeLink} onClose={() => setActiveLink(null)} />
      )}
    </>
  );
}

/** Animated three-dot "thinking" bubble shown while waiting for an answer.
 *  Mirrors the model bubble layout (avatar + beige bubble) so it reads as the
 *  assistant composing a reply. */
export function TypingIndicator({ translucent = false }: { translucent?: boolean }) {
  const { name, iconUrl } = usePersona();
  return (
    <div className="flex w-full items-start gap-2">
      <Image
        src={iconUrl}
        alt={name}
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full bg-white/90 object-cover shadow"
        priority={false}
      />
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg px-4 py-3 shadow-md",
          translucent ? "bg-[#e8e3d8]/75" : "bg-[#e8e3d8]/95",
        )}
      >
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" />
      </div>
    </div>
  );
}

/**
 * Read-only live transcript bubble - styled like a sent user bubble, sits at
 * the end of the conversation while the mic is held or still recognizing.
 * Replaced by the real bubble once the turn auto-sends (client spec
 * 2026-07-30: voice input streams straight into the chat, not the composer).
 */
export function LiveMicBubble({
  text,
  listening,
  translucent = false,
}: {
  text: string;
  /** True while actively recording; false during the post-release
   *  recognition gap (Chirp's record-then-POST path only). */
  listening: boolean;
  translucent?: boolean;
}) {
  const t = useTranslations("bottomBar");
  return (
    <div className="flex w-full justify-end">
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-4 py-2 text-sm text-white shadow-md",
          translucent ? "bg-[#7fa68b]/80" : "bg-[#7fa68b]",
        )}
      >
        {text || (
          <span className="text-white/70">
            {listening ? t("listening") : t("recognizing")}
          </span>
        )}
      </div>
    </div>
  );
}

export type MessageBubbleProps = {
  message: ChatMessage;
  onSendSuggestion?: (text: string) => void;
  onViewCitation?: (citation: Citation) => void;
  /** Open a bare URL found in the answer text in an in-app viewer instead of
   *  navigating away (client spec 2026-07-30). Omit to leave URLs as plain
   *  text (e.g. before this feature is wired up somewhere). */
  onOpenLink?: (url: string) => void;
  /** Edit an already-sent user message (Messenger-style). Omit to disable
   *  editing (e.g. suggestion chips render their own bubble-less text). */
  onEditMessage?: (id: string, text: string) => void;
  /** When true, bubbles use a more see-through background so the avatar shows
   *  through on the mobile overlay layout. Desktop leaves this off (#55 reversal). */
  translucent?: boolean;
};

export function MessageBubble({
  message,
  onSendSuggestion,
  onViewCitation,
  onOpenLink,
  onEditMessage,
  translucent = false,
}: MessageBubbleProps) {
  const t = useTranslations("chat");
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.text);
  // Enter triggers commitEdit and unmounts the textarea (isEditing → false);
  // guard against the ensuing blur re-firing commitEdit a second time.
  const committingRef = useRef(false);
  const { name, iconUrl } = usePersona();

  // Reset the "copied" tick after a brief moment - the button visual is the
  // only feedback (no toast lib in this app).
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[ChatPanel] clipboard write failed:", err);
    }
  };

  // Auto-grow with content (classic scrollHeight trick) rather than a fixed
  // row count - a wrapped multi-line edit would otherwise scroll inside a
  // single-row box instead of visibly growing like a real bubble.
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const startEdit = () => {
    setEditValue(message.text);
    committingRef.current = false;
    setIsEditing(true);
  };

  const commitEdit = () => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = editValue.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== message.text) onEditMessage?.(message.id, trimmed);
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      committingRef.current = true;
      setIsEditing(false);
    }
  };

  if (message.role === "user") {
    return (
      <div className="group flex w-full justify-end">
        {!isEditing && onEditMessage && (
          // Messenger-style: hidden until the bubble is hovered, sits just
          // left of it (the "tail" side, right-aligned bubble).
          <button
            type="button"
            onClick={startEdit}
            aria-label={t("edit")}
            title={t("edit")}
            className="mr-1 mt-1.5 grid h-6 w-6 shrink-0 place-items-center self-start rounded-full bg-black/15 text-white opacity-0 shadow transition group-hover:opacity-100 hover:bg-black/30"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {isEditing ? (
          <textarea
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={handleEditKeyDown}
            onBlur={commitEdit}
            ref={(el) => {
              if (el) {
                autoGrow(el);
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
            rows={1}
            className={cn(
              "max-w-[85%] min-w-[3rem] resize-none overflow-hidden whitespace-pre-wrap break-words rounded-lg px-4 py-2 text-sm text-white shadow-md outline-none ring-2 ring-white/50",
              translucent ? "bg-[#7fa68b]/80" : "bg-[#7fa68b]",
            )}
          />
        ) : (
          <div
            className={cn(
              "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-4 py-2 text-sm text-white shadow-md",
              translucent ? "bg-[#7fa68b]/80" : "bg-[#7fa68b]",
            )}
          >
            {message.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="group flex w-full items-start gap-2">
      <Image
        src={iconUrl}
        alt={name}
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full bg-white/90 object-cover shadow"
        priority={false}
      />
      <div
        className={cn(
          "relative max-w-[85%] rounded-lg px-4 py-2 pr-9 shadow-md",
          translucent ? "bg-[#e8e3d8]/75" : "bg-[#e8e3d8]/95",
        )}
      >
        <div className="whitespace-pre-wrap break-words text-sm text-zinc-900">
          {linkifyText(stripCitationMarkers(message.text), onOpenLink)}
        </div>
        {message.text.length > 0 && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? t("copied") : t("copy")}
            title={copied ? t("copied") : t("copy")}
            className={cn(
              "absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-zinc-600",
              // Default opacity-40 (was 0) so the icon is always faintly
              // visible on the beige bubble - hidden-by-default invited
              // "I didn't know there was a copy button" UX feedback.
              "opacity-40 transition group-hover:opacity-100 hover:bg-zinc-300/60 hover:text-zinc-900",
              copied && "opacity-100 text-emerald-600",
            )}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-zinc-400/40 pt-2">
            {message.citations.map((c) => (
              <button
                key={c.filename}
                type="button"
                onClick={() => onViewCitation?.(c)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full bg-zinc-300/70 px-2 py-0.5",
                  "text-[10px] font-medium text-zinc-700",
                  "transition hover:bg-zinc-400/70 hover:text-zinc-900",
                )}
                title={t("openReference") + " - " + (c.sourcePath ?? c.filename)}
              >
                <span className="max-w-[12rem] truncate">{c.filename}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
      {message.suggestions &&
        message.suggestions.length > 0 && (
          <div className="ml-12 flex flex-wrap gap-1.5">
            {message.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSendSuggestion?.(s)}
                disabled={!onSendSuggestion}
                className={cn(
                  "rounded-full border border-zinc-300 bg-white/95 px-3 py-1 text-xs text-zinc-700 shadow-sm",
                  "transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
