"use client";

import { useLocale } from "next-intl";

import { AVATAR_ICON_URL, AVATAR_NAME } from "@/lib/persona";
import {
  AVATAR_ICON_URL_MALE,
  AVATAR_NAME_MALE,
  AVATAR_NAME_MALE_ROMAJI,
} from "@/lib/persona-male";

import { useGender } from "./use-gender";

/**
 * Active avatar persona (display name + chat icon) for the selected gender.
 * Chi keeps the same display name across locales. The male avatar uses his
 * Japanese or romanised name according to the UI language.
 */
export function usePersona(): { name: string; iconUrl: string } {
  const { gender } = useGender();
  const isJa = useLocale().startsWith("ja");
  if (gender === "male") {
    return {
      name: isJa ? AVATAR_NAME_MALE : AVATAR_NAME_MALE_ROMAJI,
      iconUrl: AVATAR_ICON_URL_MALE,
    };
  }
  return {
    name: AVATAR_NAME,
    iconUrl: AVATAR_ICON_URL,
  };
}
