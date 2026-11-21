"use client";

import {
  HelpCircle,
  Mic,
  MicOff,
  SkipForward,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { MicLangPicker } from "@/components/mic-lang-picker";
import type { MicLang } from "@/lib/audio/mic-input-langs";
import { cn } from "@/lib/utils";

type BottomBarProps = {
  micActive: boolean;
  recognizing: boolean;
  audioMuted: boolean;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Controlled input value + setter, owned by the session so the mic can
   *  show a live preview here while talking. */
  draft: string;
  onDraftChange: (v: string) => void;
  /** Mic input language + setter. Drives whether STT streams (live text) or
   *  falls back to Chirp, and which language it recognises. */
  micLang: MicLang;
  onMicLangChange: (l: MicLang) => void;
  /** Push-to-talk: held down opens the mic, release closes it and shows the
   *  transcript. Not a toggle - the customer found the toggle ambiguous. */
  onMicPressStart: () => void;
  onMicPressEnd: () => void;
  onToggleAudio: () => void;
  onSend: (text: string) => void;
  onSkip?: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
};

/**
 * Bottom-aligned input bar mirroring the Unity layout:
 *   [brand] [text input + mic + send] [speaker + settings + help]
 *
 * Mic is push-to-talk on click/hold; the "M" hotkey does the same thing via
 * `useKeyPtt` in the parent. Both auto-send on release.
 */
export function BottomBar({
  micActive,
  recognizing,
  audioMuted,
  disabled = false,
  inputRef,
  draft,
  onDraftChange,
  micLang,
  onMicLangChange,
  onMicPressStart,
  onMicPressEnd,
  onToggleAudio,
  onSend,
  onSkip,
  onOpenSettings,
  onOpenHelp,
}: BottomBarProps) {
  const t = useTranslations("bottomBar");
  const heldRef = useRef(false);
  const [inputFocused, setInputFocused] = useState(false);

  // Mutual exclusivity (client spec): typing greys out the mic button so it
  // can't be clicked mid-type; holding the mic hides the composer row so the
  // button isn't fighting for space with the text input. The button stays
  // MOUNTED (disabled + dimmed, not removed) - `!micActive` still guards it so
  // the disabled state is never toggled while a pointer is actively captured
  // on it, which some browsers treat as an implicit capture release (the same
  // "release event never arrives" risk as unmounting it would have been).
  const micButtonDimmed = inputFocused && !micActive;
  const talking = micActive || recognizing;

  // Push-to-talk. Pointer events cover mouse + touch + pen in one path, and
  // capturing the pointer means a release that lands outside the button still
  // ends the hold - without it the mic stays open when the finger slides off.
  const startPress = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || heldRef.current) return;
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

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur">
      {/* Far left: mic input-language picker (replaced the brand block). Stays
          put while talking (client feedback: hiding it shifted the whole bar) -
          only the text area itself changes. */}
      <MicLangPicker value={micLang} onChange={onMicLangChange} disabled={disabled} />

      {/* Center: mic + input + skip on the white bar (no dark pill) */}
      <div className="flex flex-1 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={micActive ? t("micStop") : t("micStart")}
          disabled={disabled || micButtonDimmed}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          // Safety net: if the browser drops the capture mid-hold, treat it as a
          // release so the mic can never latch on.
          onLostPointerCapture={endPress}
          // Stop the long-press text selection / context menu on touch.
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none", userSelect: "none" }}
          className={cn(
            "h-10 w-10 shrink-0 rounded-full transition-opacity",
            micButtonDimmed && "opacity-30",
            micActive
              ? "bg-sky-500 text-white hover:bg-sky-400"
              : "bg-transparent text-zinc-700 hover:bg-zinc-200",
          )}
        >
          {micActive ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>

        {talking ? (
          // Voice input now streams straight into a bubble in the
          // conversation (see LiveMicBubble in ChatPanel), not here - an
          // empty flex-1 spacer keeps mic/skip positioned the same as when
          // the input is showing (client spec 2026-07-30).
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
            disabled={disabled}
            placeholder={t("placeholder")}
            className="flex-1 border-b border-zinc-300 bg-transparent px-2 py-1 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          />
        )}

        {!talking && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skip")}
            disabled={disabled || (!onSkip && draft.trim().length === 0)}
            onClick={() => {
              if (draft.trim().length > 0) submit();
              else onSkip?.();
            }}
            className="h-10 w-10 shrink-0 rounded-full bg-transparent text-zinc-700 hover:bg-zinc-200 disabled:opacity-40"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Right icons: speaker / settings / help */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={audioMuted ? t("audioOn") : t("audioOff")}
          onClick={onToggleAudio}
          className="h-10 w-10 rounded-full text-zinc-700 hover:bg-zinc-200"
        >
          {audioMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("settings")}
          onClick={onOpenSettings}
          className="h-10 w-10 rounded-full text-zinc-700 hover:bg-zinc-200"
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("help")}
          onClick={onOpenHelp}
          className="h-10 w-10 rounded-full text-zinc-700 hover:bg-zinc-200"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
