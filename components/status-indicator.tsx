"use client";

import { useTranslations } from "next-intl";

import type { SessionStatus } from "@/hooks/use-gemini-session";
import { cn } from "@/lib/utils";

type StatusIndicatorProps = {
  status: SessionStatus;
  error?: string | null;
};

const TONES: Record<SessionStatus, string> = {
  idle: "bg-zinc-500/60",
  connecting: "bg-amber-500/70",
  ready: "bg-emerald-500/70",
  listening: "bg-sky-500/80",
  disconnected: "bg-zinc-700/70",
  error: "bg-red-600/80",
};

export function StatusIndicator({ status, error }: StatusIndicatorProps) {
  const t = useTranslations("status");
  // Hide the chip in the calm "ready" state - matches Unity which has no
  // status overlay - but always show errors so the user can react. Sits
  // below the lang switcher (top-right) thanks to extra `top-` offset.
  const hideChip = status === "ready" && !error;

  return (
    <div className="pointer-events-none absolute right-4 top-16 flex flex-col items-end gap-1">
      {!hideChip && (
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium text-white shadow",
            TONES[status],
          )}
        >
          {t(status)}
        </span>
      )}
      {error && (
        <span className="max-w-xs rounded-md bg-red-600/80 px-2 py-1 text-xs text-white shadow">
          {error}
        </span>
      )}
    </div>
  );
}
