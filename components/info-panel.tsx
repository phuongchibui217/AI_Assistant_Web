"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type InfoPanelProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Centred modal overlay shared by Settings and Help. Click outside or press
 * the close button to dismiss. Kept deliberately small - the Unity Settings /
 * Help panels are also stubs in the demo build, so we match that scope.
 */
export function InfoPanel({ open, title, onClose, children }: InfoPanelProps) {
  const t = useTranslations("infoPanel");
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-zinc-900/95 p-6 text-sm text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("close")}
            onClick={onClose}
            className="h-8 w-8 rounded-full text-zinc-300 hover:bg-zinc-700/60 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2 leading-relaxed text-zinc-200">{children}</div>
      </div>
    </div>
  );
}
