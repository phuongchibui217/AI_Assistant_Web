"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  MIC_LANG_OPTIONS,
  micLangOption,
  type MicLang,
} from "@/lib/audio/mic-input-langs";
import { cn } from "@/lib/utils";

/**
 * Mic input-language picker. Replaces the brand block next to the mic; lets the
 * user choose which language the microphone transcribes with live text.
 *
 * Opens UPWARD (it sits at the bottom of the viewport).
 */
export function MicLangPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: MicLang;
  onChange: (l: MicLang) => void;
  disabled?: boolean;
  /** Mobile composer variant: a single round flag button (matches the mic
   *  button) instead of the desktop stacked icon + code label. */
  compact?: boolean;
}) {
  const t = useTranslations("bottomBar");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = micLangOption(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const pick = (code: MicLang) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex flex-col items-center">
      {compact ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-label={t("micLangTitle")}
          aria-expanded={open}
          title={t("micLangTitle")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-xl text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
        >
          <span aria-hidden>{current.flag}</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-label={t("micLangTitle")}
          aria-expanded={open}
          title={t("micLangTitle")}
          className="flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-sky-500 text-lg text-white shadow">
            {current.flag}
          </span>
          <span className="flex items-center gap-0.5">
            {current.code === "ja" ? "JP" : current.code.toUpperCase()}
            <ChevronDown className="h-3 w-3" />
          </span>
        </button>
      )}

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[60vh] w-56 overflow-auto rounded-lg border bg-white p-1 text-zinc-900 shadow-xl">
          <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            {t("micLangLive")}
          </div>
          {MIC_LANG_OPTIONS.map(({ code, flag, name }) => (
            <button
              key={code}
              type="button"
              onClick={() => pick(code)}
              aria-pressed={code === current.code}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100",
                code === current.code && "font-medium",
              )}
            >
              <span aria-hidden className="w-5 text-base leading-none">{flag}</span>
              <span className="flex-1 truncate">{name}</span>
              {code === current.code && <Check className="h-3.5 w-3.5 text-sky-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
