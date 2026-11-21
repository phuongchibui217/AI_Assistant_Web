"use client";

import { ArrowLeftRight, Eye, EyeOff, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocaleCookie } from "@/lib/locale-cookie";
import type { Gender } from "@/hooks/use-gender";
import { MIC_LANG_OPTIONS } from "@/lib/audio/mic-input-langs";
import type { SupportedLang } from "@/lib/lang-detect";
import { cn } from "@/lib/utils";

const LANG_OPTIONS: Array<{ code: "vi" | "en" | "ja" | "zh-TW"; label: string }> = [
  { code: "vi", label: "VI" },
  { code: "en", label: "EN" },
  { code: "ja", label: "JA" },
  { code: "zh-TW", label: "ZH" },
];

// Interpreter mode: both sides of the pair are user-selectable (client spec
// 2026-08-18, revised from an earlier ja<->foreign-only lock) - reuses the
// mic-language list minus "auto" (not a real language to translate into).
// Exported so MobileChat's header picker stays in lock-step with desktop.
export const TRANSLATE_LANG_OPTIONS = MIC_LANG_OPTIONS.filter(
  (o) => o.code !== "auto",
) as Array<{ code: SupportedLang; name: string; flag: string }>;

/**
 * Top-right floating pill: gender segmented control + avatar show/hide toggle
 * + language switcher, all in one bar so none of them need the Settings panel
 * (client spec 2026-07-30) - previously the lang switcher was a separate
 * flag-emoji pill; folded in here with the same segmented-button style.
 */
export function TopBar({
  gender,
  onGenderChange,
  avatarAdminEnabled,
  avatarVisible,
  onToggleAvatarVisible,
  translateEnabled,
  onToggleTranslateEnabled,
  translateLangA,
  translateLangB,
  onTranslateLangAChange,
  onTranslateLangBChange,
  onSwapTranslateLangs,
}: {
  gender: Gender;
  onGenderChange: (g: Gender) => void;
  /** Admin `avatar_enabled` setting - the show/hide button only appears when
   *  there is actually an avatar to show; the admin flag always wins. */
  avatarAdminEnabled: boolean;
  avatarVisible: boolean;
  onToggleAvatarVisible: () => void;
  /** Interpreter mode (client spec 2026-08-18): both sides of the pair are
   *  selectable, e.g. English <-> Korean. */
  translateEnabled: boolean;
  onToggleTranslateEnabled: () => void;
  translateLangA: SupportedLang;
  translateLangB: SupportedLang;
  onTranslateLangAChange: (lang: SupportedLang) => void;
  onTranslateLangBChange: (lang: SupportedLang) => void;
  onSwapTranslateLangs: () => void;
}) {
  const t = useTranslations("topBar");
  const tSettings = useTranslations("settings");
  const tLang = useTranslations("lang");
  const currentLocale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // No collapse toggle: the client asked for this bar to be permanently
  // visible (2026-09-25) because the chevron was too easy to miss. It was
  // originally collapsed to hide the width the translate pickers added
  // (2026-08-18), so the pickers now stay behind their own toggle
  // (`translateEnabled`) and shrink on mobile instead.

  const chooseLocale = (code: "vi" | "ja" | "en" | "zh-TW") => {
    if (code === currentLocale || pending) return;
    setLocaleCookie(code);
    startTransition(() => router.refresh());
  };

  const genderOptions: Array<{ value: Gender; label: string }> = [
    { value: "female", label: tSettings("genderFemale") },
    { value: "male", label: tSettings("genderMale") },
  ];

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-full bg-black/30 px-2 py-1 backdrop-blur">
          <div className="flex items-center gap-0.5">
            {genderOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onGenderChange(o.value)}
                aria-pressed={gender === o.value}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  gender === o.value
                    ? "bg-white/90 text-zinc-900 shadow"
                    : "text-white/70 hover:text-white",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {avatarAdminEnabled && (
            <>
              <div className="h-4 w-px bg-white/25" aria-hidden />
              <button
                type="button"
                onClick={onToggleAvatarVisible}
                aria-label={avatarVisible ? t("hideAvatar") : t("showAvatar")}
                title={avatarVisible ? t("hideAvatar") : t("showAvatar")}
                className="grid h-7 w-7 place-items-center rounded-full text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                {avatarVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </>
          )}

          <div className="h-4 w-px bg-white/25" aria-hidden />
          <div aria-label={tLang("switchTo")} className="flex items-center gap-0.5">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => chooseLocale(opt.code)}
                disabled={pending}
                aria-label={tLang(opt.code)}
                aria-pressed={currentLocale === opt.code}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  currentLocale === opt.code
                    ? "bg-white/90 text-zinc-900 shadow"
                    : "text-white/70 hover:text-white",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-white/25" aria-hidden />
          <button
            type="button"
            onClick={onToggleTranslateEnabled}
            aria-pressed={translateEnabled}
            aria-label={t("translateMode")}
            title={t("translateMode")}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-full transition",
              translateEnabled
                ? "bg-white/90 text-zinc-900 shadow"
                : "text-white/80 hover:bg-white/20 hover:text-white",
            )}
          >
            <Languages className="h-4 w-4" />
          </button>
          {translateEnabled && (
            <div className="flex max-w-[52vw] items-center gap-1 rounded-full bg-white/90 px-1 text-xs text-zinc-900 shadow sm:max-w-none">
              <select
                value={translateLangA}
                onChange={(e) => onTranslateLangAChange(e.target.value as SupportedLang)}
                aria-label={t("translateLangA")}
                className="min-w-0 max-w-[22vw] truncate rounded-full border-none bg-transparent py-1 pl-2 pr-1 text-xs text-zinc-900 outline-none sm:max-w-none"
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
                aria-label={t("translateSwap")}
                title={t("translateSwap")}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                <ArrowLeftRight className="h-3 w-3" />
              </button>
              <select
                value={translateLangB}
                onChange={(e) => onTranslateLangBChange(e.target.value as SupportedLang)}
                aria-label={t("translateLangB")}
                className="min-w-0 max-w-[22vw] truncate rounded-full border-none bg-transparent py-1 pl-1 pr-2 text-xs text-zinc-900 outline-none sm:max-w-none"
              >
                {TRANSLATE_LANG_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.flag} {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
      </div>
    </div>
  );
}
