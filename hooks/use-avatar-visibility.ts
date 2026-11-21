"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Client-side "text only" preference - hides the avatar without touching the
 * admin `avatar_enabled` setting. Orthogonal to it: the effective visibility
 * is `avatar_enabled && avatarVisible`, so a user can only ever hide an avatar
 * the admin has already turned on, never force one back on that the admin
 * disabled.
 *
 * Persisted to localStorage so the choice survives a reload. Defaults to
 * `true` (avatar shown), matching the pre-existing behaviour.
 *
 * Same module-level subscriber-store shape as `useGender` so every consumer
 * (top bar toggle, mobile header button) re-renders together on a change.
 */
const STORAGE_KEY = "avatar-visible";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function write(v: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    // ignore - private mode / storage disabled; the in-memory state still works
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAvatarVisibility(): {
  avatarVisible: boolean;
  setAvatarVisible: (v: boolean) => void;
  toggle: () => void;
} {
  // Server + first client (hydration) snapshot is always `true` to match SSR;
  // useSyncExternalStore re-renders to the stored value right after hydration.
  const avatarVisible = useSyncExternalStore<boolean>(subscribe, read, () => true);

  const setAvatarVisible = useCallback((v: boolean) => {
    write(v);
    emit();
  }, []);

  const toggle = useCallback(() => {
    write(!read());
    emit();
  }, []);

  return { avatarVisible, setAvatarVisible, toggle };
}
