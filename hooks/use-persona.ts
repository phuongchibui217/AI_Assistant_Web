"use client";

import { AVATAR_ICON_URL, AVATAR_NAME } from "@/lib/persona";
import {
  AVATAR_ICON_URL_MALE,
  AVATAR_NAME_MALE,
} from "@/lib/persona-male";

import { useGender } from "./use-gender";

/**
 * Active avatar persona (display name + chat icon) for the selected gender.
 * Display names are consistent across locales.
 */
export function usePersona(): { name: string; iconUrl: string } {
  const { gender } = useGender();
  if (gender === "male") {
    return {
      name: AVATAR_NAME_MALE,
      iconUrl: AVATAR_ICON_URL_MALE,
    };
  }
  return {
    name: AVATAR_NAME,
    iconUrl: AVATAR_ICON_URL,
  };
}
