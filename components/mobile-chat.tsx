"use client";

import {
  ArrowLeftRight,
  Eye,
  EyeOff,
  HelpCircle,
  Languages,
  Mic,
  MicOff,
  Send,
  Settings,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { CitationViewer } from "@/components/citation-viewer";
import { findLastUserMessageId, LiveMicBubble, MessageBubble, TypingIndicator, tryNavigateToSource } from "@/components/chat-panel";
import { LinkViewer } from "@/components/link-viewer";
import { MicLangPicker } from "@/components/mic-lang-picker";
import { Button } from "@/components/ui/button";
import { TRANSLATE_LANG_OPTIONS, type MicLang } from "@/lib/audio/mic-input-langs";
import type { ChatMessage } from "@/hooks/use-chat-messages";
import type { Gender } from "@/hooks/use-gender";
import type { SessionStatus } from "@/hooks/use-gemini-session";
import type { Avatar } from "@/lib/avatar/avatar";
import type { CharacterConfig } from "@/lib/avatar/characters";
import type { SupportedLang } from "@/lib/lang-detect";
import { usePersona } from "@/hooks/use-persona";
import { setLocaleCookie } from "@/lib/locale-cookie";
import { cn } from "@/lib/utils";

// Lazy-load AvatarScene so Three.js is only fetched/executed when the admin
// avatar setting is on. When avatar is disabled this never renders, so mobile
// keeps the lightweight messenger layout with no WebGL cost.
const AvatarSceneLazy = dynamic(
  () => import("@/components/avatar-scene").then((m) => m.AvatarScene),
  { ssr: false },
);

const LANG_OPTIONS: Array<{ code: "vi" | "ja" | "en" | "zh-TW"; flag: string }> = [
  { code: "vi", flag: "🇻🇳" },
  { code: "ja", flag: "🇯🇵" },
  { code: "en", flag: "🇺🇸" },
  { code: "zh-TW", flag: "🇹🇼" },
];

const STATUS_DOT: Record<SessionStatus, string> = {
  idle: "bg-zinc-400",
  connecting: "bg-amber-400",
  ready: "bg-emerald-400",
  listening: "bg-sky-400 animate-pulse",
  disconnected: "bg-zinc-600",
  error: "bg-red-500",
};

type MobileChatProps = {
  messages: ChatMessage[];
  thinking: boolean;
  status: SessionStatus;
  errorMessage?: string | null;
  micActive: boolean;
  recognizing: boolean;
  audioMuted: boolean;
  interactionDisabled: boolean;
  inputRef?: RefObject<HTMLInputElement>;
  /** Controlled input value + setter, owned by the session so the mic can
   *  show a live preview here while talking. */
  draft: string;
  onDraftChange: (v: string) => void;
  /** Mic input language + setter (STT streaming vs Chirp routing). */
  micLang: MicLang;
  onMicLangChange: (l: MicLang) => void;
  /** When true (admin avatar setting on), render the 3D avatar full-screen with
   *  a translucent chat overlay; when false, the lightweight messenger layout. */
  showAvatar: boolean;
  /** Which character sprite set to render (gender toggle). */
  avatarConfig: CharacterConfig;
  /** Current scene background src, resolved async in app-shell; `null` until
   *  the admin-selected background loads (renders plain black meanwhile). */
  backgroundSrc: string | null;
  /** Fires once the avatar finishes loading (avatar mode only) so the parent can
   *  bind audio + drive the session connect. */
  onAvatarReady?: (avatar: Avatar) => void;
  /** Push-to-talk: held down opens the mic, release closes it and shows the
   *  transcript. Not a toggle - the customer found the toggle ambiguous. */
  onMicPressStart: () => void;
  onMicPressEnd: () => void;
  onToggleAudio: () => void;
  onSend: (text: string) => void;
  onSendSuggestion: (text: string) => void;
  /** Edit an already-sent user message (Messenger-style). */
  onEditMessage?: (id: string, text: string) => void;
  /** Interrupt the current TTS playback / in-flight answer (parity with the
   *  desktop bottom bar's skip button). */
  onSkip: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  /** Admin `avatar_enabled` setting - the header's show/hide button only
   *  appears when there is actually an avatar to show. */
  avatarAdminEnabled: boolean;
  /** User's own text-only preference (orthogonal to the admin setting). */
  avatarVisible: boolean;
  onToggleAvatarVisible: () => void;
  /** Avatar gender - reachable from the header directly, not only Settings
   *  (client spec 2026-07-30). */
  gender: Gender;
  onToggleGender: () => void;
  /** Interpreter mode (client spec 2026-08-18): both sides of the pair are
   *  selectable, mirrors the desktop TopBar toggle. */
  translateEnabled: boolean;
  onToggleTranslateEnabled: () => void;
  translateLangA: SupportedLang;
  translateLangB: SupportedLang;
  onTranslateLangAChange: (lang: SupportedLang) => void;
  onTranslateLangBChange: (lang: SupportedLang) => void;
  onSwapTranslateLangs: () => void;
};

/**
 * Inline lang switcher for the mobile header. Was 3 separate flag buttons
 * (client feedback 2026-09-15: too crowded alongside gender/eye/mute/settings/
 * help/translate in the same row on narrow screens) - now a single native
 * `<select>` showing only the current flag, opening the OS picker for the
 * other 2. Same cookie/refresh logic as LangSwitcher / desktop TopBar.
 */
function MobileLangButtons() {
  const current = useLocale();
  const router = useRouter();
  const t = useTranslations("lang");
  const [pending, startTransition] = useTransition();

  const choose = (code: "vi" | "ja" | "en" | "zh-TW") => {
    if (code === current || pending) return;
    setLocaleCookie(code);
    startTransition(() => router.refresh());
  };

  return (
    <select
      value={current}
      onChange={(e) => choose(e.target.value as "vi" | "ja" | "en" | "zh-TW")}
      disabled={pending}
      aria-label={t("switchTo")}
      className="h-9 w-9 shrink-0 cursor-pointer appearance-none rounded-full border-none bg-transparent text-center text-lg outline-none"
    >
      {LANG_OPTIONS.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {opt.flag}
        </option>
      ))}
    </select>
  );
}

/**
 * Full-viewport mobile chat (portrait / narrow viewport). Two modes driven by
 * `showAvatar` (the admin avatar setting, now honored on mobile too):
 *   - avatar on  → 3D avatar full-screen background + translucent chat overlay
 *                  anchored to the bottom, header/composer over it.
 *   - avatar off → lightweight Messenger-style layout, static icon in header,
 *                  no WebGL (feedback #55 fallback).
 * Both modes share the same header rows + composer; only the chrome (colors,
 * transparency) and the messages region's sizing differ.
 */
export function MobileChat({
  messages,
  thinking,
  status,
  errorMessage,
  micActive,
  recognizing,
  audioMuted,
  interactionDisabled,
  inputRef,
  draft,
  onDraftChange,
  micLang,
  onMicLangChange,
  showAvatar,
  avatarConfig,
  backgroundSrc,
  onAvatarReady,
  onMicPressStart,
  onMicPressEnd,
  onToggleAudio,
  onSend,
  onSendSuggestion,
  onEditMessage,
  onSkip,
  onOpenSettings,
  onOpenHelp,
  avatarAdminEnabled,
  avatarVisible,
  onToggleAvatarVisible,
  gender,
  onToggleGender,
  translateEnabled,
  onToggleTranslateEnabled,
  translateLangA,
  translateLangB,
  onTranslateLangAChange,
  onTranslateLangBChange,
  onSwapTranslateLangs,
}: MobileChatProps) {
  const tBar = useTranslations("bottomBar");
  const tTopBar = useTranslations("topBar");
  const tSettings = useTranslations("settings");
  const tStatus = useTranslations("status");
  const scrollRef = useRef<HTMLDivElement>(null);
  const heldRef = useRef(false);
  const [activeCitation, setActiveCitation] = useState<string | null>(null);
  const [activeLink, setActiveLink] = useState<string | null>(null);
  const persona = usePersona();
  const avatarName = persona.name;
  const avatarIcon = persona.iconUrl;

  // Only the most recently sent user message is editable (client feedback
  // 2026-07-30 - editing an older one deleted/regenerated a reply buried
  // under newer turns, reading as "my current answer just vanished").
  const lastUserMessageId = findLastUserMessageId(messages);

  // Auto-scroll to bottom on new messages, thinking state, or the live mic
  // transcript bubble growing (it lives in this same scroll container).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, draft]);

  // Push-to-talk. Pointer events cover touch + mouse in one path; capturing the
  // pointer means a release outside the button still ends the hold, so the mic
  // cannot latch on when the finger slides off.
  const startPress = (e: PointerEvent<HTMLButtonElement>) => {
    if (interactionDisabled || heldRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    heldRef.current = true;
    onMicPressStart();
  };

  const endPress = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    onMicPressEnd();
  };

  // While the mic is held (and through the recognising gap) the composer turns
  // into a read-only transcript view: the input, skip and send do nothing then,
  // and dropping them gives the text nearly the full row width.
  const talking = micActive || recognizing;

  // Typing greys out the mic button so it can't be tapped mid-type (client
  // spec). The button stays MOUNTED (disabled + dimmed) - `!micActive` guards
  // against ever disabling it while a pointer is actively captured on it (some
  // browsers treat that as an implicit capture release, losing the up event).
  const [inputFocused, setInputFocused] = useState(false);
  const micButtonDimmed = inputFocused && !micActive;

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || interactionDisabled) return;
    onSend(trimmed);
    // Drop focus so the mobile virtual keyboard dismisses right after sending,
    // letting the avatar face + chat history show without the keyboard covering
    // half the screen (Keiwa mobile UX request). Covers both the Send tap and
    // the Enter key since both route through here.
    inputRef?.current?.blur();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "relative h-[100dvh] w-full overflow-hidden",
        showAvatar ? "bg-black" : "bg-[#f5f3ef]",
      )}
    >
      {/* Avatar mode: office backdrop + 3D avatar fill the viewport behind the
          translucent chat overlay. Never mounts in messenger mode. */}
      {showAvatar && (
        <>
          {backgroundSrc && (
            <Image
              src={backgroundSrc}
              alt=""
              aria-hidden
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          )}
          <AvatarSceneLazy onReady={onAvatarReady} config={avatarConfig} />
        </>
      )}

      {/* Foreground column sits above the avatar (z-10). Transparent in avatar
          mode so the avatar shows through; opaque chrome in messenger mode. */}
      <div className="relative z-10 flex h-full flex-col">
      {/* ── Header (sticky top) ────────────────────────────────── */}
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-3 py-2 shadow-sm",
          showAvatar
            ? "border-white/20 bg-white/70 backdrop-blur-md"
            : "border-zinc-200 bg-white",
        )}
      >
        {/* Avatar icon + name + status dot */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Image
            src={avatarIcon}
            alt={avatarName}
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-full bg-white object-cover shadow"
            priority
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {avatarName}
            </p>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  STATUS_DOT[status],
                )}
              />
              {(status !== "ready" || errorMessage) && (
                <span className="truncate text-[10px] text-zinc-500">
                  {errorMessage ?? tStatus(status)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right actions: gender + avatar-visibility + mute + settings + help + lang */}
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              gender === "male" ? tSettings("genderFemale") : tSettings("genderMale")
            }
            title={gender === "male" ? tSettings("genderFemale") : tSettings("genderMale")}
            onClick={onToggleGender}
            className="h-10 w-10 rounded-full text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
          >
            {gender === "male" ? "♂" : "♀"}
          </Button>
          {avatarAdminEnabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                avatarVisible ? tTopBar("hideAvatar") : tTopBar("showAvatar")
              }
              onClick={onToggleAvatarVisible}
              className="h-10 w-10 rounded-full text-zinc-600 hover:bg-zinc-100"
            >
              {avatarVisible ? (
                <Eye className="h-5 w-5" />
              ) : (
                <EyeOff className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={audioMuted ? tBar("audioOn") : tBar("audioOff")}
            onClick={onToggleAudio}
            className="h-10 w-10 rounded-full text-zinc-600 hover:bg-zinc-100"
          >
            {audioMuted ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tBar("settings")}
            onClick={onOpenSettings}
            className="h-10 w-10 rounded-full text-zinc-600 hover:bg-zinc-100"
          >
            <Settings className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tBar("help")}
            onClick={onOpenHelp}
            className="h-10 w-10 rounded-full text-zinc-600 hover:bg-zinc-100"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-pressed={translateEnabled}
            aria-label={tTopBar("translateMode")}
            onClick={onToggleTranslateEnabled}
            className={cn(
              "h-10 w-10 rounded-full",
              translateEnabled
                ? "bg-zinc-900 text-white hover:bg-zinc-800"
                : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            <Languages className="h-5 w-5" />
          </Button>
          <MobileLangButtons />
        </div>
      </header>

      {/* Interpreter-mode language picker: its own slim row instead of
          crowding the already-dense header button row further. */}
      {translateEnabled && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-end gap-1.5 border-b px-3 py-1.5",
            showAvatar
              ? "border-white/20 bg-white/70 backdrop-blur-md"
              : "border-zinc-200 bg-white",
          )}
        >
          <select
            value={translateLangA}
            onChange={(e) => onTranslateLangAChange(e.target.value as SupportedLang)}
            aria-label={tTopBar("translateLangA")}
            className="min-w-0 flex-1 appearance-none truncate rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-900"
          >
            {TRANSLATE_LANG_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.flag} {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onSwapTranslateLangs}
            aria-label={tTopBar("translateSwap")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
          <select
            value={translateLangB}
            onChange={(e) => onTranslateLangBChange(e.target.value as SupportedLang)}
            aria-label={tTopBar("translateLangB")}
            className="min-w-0 flex-1 appearance-none truncate rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-900"
          >
            {TRANSLATE_LANG_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.flag} {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Avatar mode: spacer pushes the chat overlay down so the avatar's face
          stays visible in the upper area; messages hug the composer. */}
      {showAvatar && <div className="flex-1" aria-hidden />}

      {/* ── Messages ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className={cn(
          "flex flex-col gap-3 overflow-y-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // Cap the overlay at half the viewport (avatar mode) so a long answer
          // never climbs over the avatar's head; it scrolls within this band.
          // Gradient mask: the newest message (bottom, near the composer) stays
          // fully opaque/readable, older ones soften as they climb toward the
          // avatar's face. The fade band is a FIXED 16px at the very top edge
          // (`calc(100% - 16px)`), NOT a percentage: a percentage fades that
          // share of the container height, so on a tall answer 15% was still
          // ~2 lines and the first line stayed unreadable (client feedback, kept
          // recurring through 55%/85% tweaks). 16px is under one line-height, so
          // the topmost line stays legible even while scrolled (話はじめ). Tune
          // this one number if the edge looks too hard/soft. -webkit- for iOS.
          showAvatar
            ? "max-h-[50dvh] pb-3 pt-2 [mask-image:linear-gradient(to_top,black_calc(100%_-_16px),transparent)] [-webkit-mask-image:linear-gradient(to_top,black_calc(100%_-_16px),transparent)]"
            : "flex-1 py-4",
        )}
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
            translucent={showAvatar}
          />
        ))}
        {thinking && <TypingIndicator translucent={showAvatar} />}
        {talking && (
          <LiveMicBubble text={draft} listening={micActive} translucent={showAvatar} />
        )}
      </div>

      {/* ── Composer (sticky bottom, never scrolls away - feedback #57) ── */}
      <div
        className={cn(
          "shrink-0 border-t px-3 py-2",
          showAvatar
            ? "border-white/20 bg-white/85 backdrop-blur shadow-[0_-2px_8px_rgba(0,0,0,0.12)]"
            : "border-zinc-200 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)]",
        )}
      >
        {/* items-end, not items-center: the composer is anchored to the bottom of
            the viewport, so aligning on the bottom edge keeps the mic button at a
            fixed spot while the transcript grows upward. Centering moved the
            button down under the user's thumb mid-hold (customer 2026-07-21). */}
        <div className="flex items-end gap-2">
          {/* Mic input-language picker, left of the mic (mirrors desktop).
              Stays put while talking (client feedback: hiding it shifted the
              whole bar) - only the text area itself changes. */}
          <MicLangPicker
            value={micLang}
            onChange={onMicLangChange}
            disabled={interactionDisabled}
            compact
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={micActive ? tBar("micStop") : tBar("micStart")}
            disabled={interactionDisabled || micButtonDimmed}
            onPointerDown={startPress}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            // Safety net: if the browser drops the capture mid-hold, treat it
            // as a release so the mic can never latch on.
            onLostPointerCapture={endPress}
            // Stop the long-press text selection / context menu on touch.
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: "none", userSelect: "none" }}
            className={cn(
              "h-11 w-11 shrink-0 rounded-full transition-opacity",
              micButtonDimmed && "opacity-30",
              micActive
                ? "bg-sky-500 text-white hover:bg-sky-400"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
            )}
          >
            {micActive ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>

          {talking ? (
            // Voice input now streams straight into a bubble in the message
            // list above (LiveMicBubble), not here - an empty flex-1 spacer
            // keeps mic/skip/send positioned the same as when the input is
            // showing (client spec 2026-07-30).
            <div className="flex-1" />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={handleKey}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              disabled={interactionDisabled}
              placeholder={tBar("placeholder")}
              // text-base (16px): iOS Safari auto-zooms the page when focusing an
              // input whose font-size is < 16px. Keeping it at 16px stops the
              // zoom-on-tap the BA reported. (Belt-and-suspenders global rule in
              // globals.css too.)
              // min-w-0: a flex item defaults to min-width:auto, and a text input
              // has an intrinsic ~20ch preferred width (~180px). Without this the
              // input refuses to shrink on narrow phones, widening the row past
              // the viewport and pushing the Send button off the right edge (it
              // showed only partially and taps missed it - Keiwa mobile report).
              className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none disabled:opacity-50"
            />
          )}

          {!talking && (
            <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tBar("skip")}
              disabled={interactionDisabled}
              onClick={onSkip}
              className={cn(
                "h-11 w-11 shrink-0 rounded-full",
                showAvatar
                  ? "bg-white/70 text-zinc-700 hover:bg-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
              )}
            >
              <SkipForward className="h-5 w-5" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tBar("send")}
              disabled={interactionDisabled || draft.trim().length === 0}
              onClick={submit}
              className="h-11 w-11 shrink-0 rounded-full bg-[#7fa68b] text-white hover:bg-[#6e9479] disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              <Send className="h-5 w-5" />
            </Button>
            </>
          )}
        </div>
      </div>
      </div>

      {/* Citation viewer - full-screen on mobile (handled in CitationViewer CSS) */}
      {activeCitation && (
        <CitationViewer
          filename={activeCitation}
          onClose={() => setActiveCitation(null)}
        />
      )}
      {activeLink && (
        <LinkViewer url={activeLink} onClose={() => setActiveLink(null)} />
      )}
    </div>
  );
}
