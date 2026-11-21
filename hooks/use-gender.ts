"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Client-side avatar gender selection (issue 5). This is a local, per-browser
 * preference - NOT an admin setting - toggled from the client Settings panel.
 * It drives which character sprite set, voice, icon, and persona are used.
 *
 * Orthogonal to the admin `avatar_enabled` / `voice_enabled` flags: those still
 * gate whether the avatar/voice show at all, regardless of the chosen gender.
 *
 * Persisted to localStorage so the choice survives a reload. Defaults to
 * "female" (the original, fully-calibrated avatar).
 *
 * Backed by a module-level subscriber set (useSyncExternalStore) rather than a
 * per-component useState so that switching gender re-renders EVERY consumer at
 * once - including chat bubbles that mounted before the switch. The old
 * per-instance state only updated newly-mounted bubbles, leaving the greeting
 * (and any earlier reply) showing the previous gender's icon.
 */
export type Gender = "female" | "male";

const STORAGE_KEY = "avatar-gender";

function read(): Gender {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}

/**
 * Synchronous, non-reactive read of the persisted gender. For non-React
 * callers (e.g. the TTS synthesis path) that need the live value at call time
 * without subscribing to changes. Reuses the same key + fallback as the hook.
 */
export function readStoredGender(): Gender {
  return read();
}

function write(g: Gender): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, g);
  } catch {
    // ignore - private mode / storage disabled; the in-memory state still works
  }
}

// Subscribers across all useGender() consumers. emit() fans a change out to
// every mounted bubble/persona so a switch updates them together.
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab: another tab writing the key fires a storage event here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useGender(): {
  gender: Gender;
  setGender: (g: Gender) => void;
  toggle: () => void;
} {
  // Server + first client (hydration) snapshot is always "female" to match SSR;
  // useSyncExternalStore re-renders to the stored value right after hydration.
  const gender = useSyncExternalStore<Gender>(subscribe, read, () => "female");

  const setGender = useCallback((g: Gender) => {
    write(g);
    emit();
  }, []);

  const toggle = useCallback(() => {
    write(read() === "female" ? "male" : "female");
    emit();
  }, []);

  return { gender, setGender, toggle };
}
