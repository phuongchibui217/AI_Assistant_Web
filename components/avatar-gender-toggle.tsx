"use client";

import { useTranslations } from "next-intl";

import type { Gender } from "@/hooks/use-gender";
import { cn } from "@/lib/utils";

/**
 * Segmented control in the client Settings panel to switch the avatar between
 * the female (Chi) and male (Lee) character. Driving state lives in the parent
 * (`useGender` in app-shell) so the avatar, icon, name, and voice all read the
 * same value.
 */
export function AvatarGenderToggle({
  gender,
  onChange,
}: {
  gender: Gender;
  onChange: (g: Gender) => void;
}) {
  const t = useTranslations("settings");
  const options: Array<{ value: Gender; label: string }> = [
    { value: "female", label: t("genderFemale") },
    { value: "male", label: t("genderMale") },
  ];

  return (
    <div>
      <p className="mb-2 font-medium text-zinc-200">{t("genderLabel")}</p>
      <div className="inline-flex rounded-lg border border-white/15 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={gender === o.value}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm transition",
              gender === o.value
                ? "bg-white text-zinc-900"
                : "text-zinc-300 hover:text-white",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
