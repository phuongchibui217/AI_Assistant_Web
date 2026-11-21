"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SupportedLang } from "@/lib/lang-detect";

/**
 * Interpreter mode (top-bar Translate toggle, client spec 2026-08-07 - Taiwan
 * exhibition Sept 2026). Client-side, per-browser preference like
 * `useGender`: NOT an admin setting.
 *
 * The pair is two freely-selectable languages (`langA` <-> `langB`, client
 * spec 2026-08-18: originally locked to "Japanese <-> foreign", client then
 * asked to pick either side - e.g. English <-> Korean). `handleUserMessage`
 * picks the translate direction per-turn by detecting which side the input
 * matches.
 *
 * Persisted to localStorage + `useSyncExternalStore` (same shape as
 * `use-gender.ts`) so the choice survives a reload AND so `handleUserMessage`
 * inside `useGeminiSession` - a different hook, called from a non-React code
 * path per turn - can read the live value synchronously via
 * `readTranslateMode()` without prop-drilling through the hook boundary.
 */
const ENABLED_KEY = "translate-mode-enabled";
const LANG_A_KEY = "translate-mode-lang-a";
const LANG_B_KEY = "translate-mode-lang-b";

// Per-deployment starting pair (admin Settings -> default translate languages;
// Taiwan wants TW <-> English, Wise keeps JP <-> English). Module-level rather
// than React state because `readTranslateMode()` below is called from the
// per-turn TTS/translate path, which is NOT inside a component and cannot read
// props. `configureTranslateDefaults` is therefore called once from AppShell
// with the server-provided values before anything reads them.
//
// These only apply when localStorage is EMPTY. A visitor who has already used
// interpreter mode on this browser keeps their own pair - worth knowing when
// testing on a phone that has seen an earlier build.
let DEFAULT_LANG_A: SupportedLang = "ja";
let DEFAULT_LANG_B: SupportedLang = "en";

export function configureTranslateDefaults(
  langA: SupportedLang,
  langB: SupportedLang,
): void {
  DEFAULT_LANG_A = langA;
  DEFAULT_LANG_B = langB;
}

export type TranslateModeState = {
  enabled: boolean;
  langA: SupportedLang;
  langB: SupportedLang;
};

// useSyncExternalStore requires getSnapshot to return a STABLE reference
// when nothing changed (it compares via Object.is) - a fresh object literal
// on every call reads as "always changed" and loops forever. Cache the last
// snapshot and only allocate a new one when a value actually differs.
let cached: TranslateModeState = {
  enabled: false,
  langA: DEFAULT_LANG_A,
  langB: DEFAULT_LANG_B,
};

function readRaw(): TranslateModeState {
  try {
    return {
      enabled: window.localStorage.getItem(ENABLED_KEY) === "1",
      langA:
        (window.localStorage.getItem(LANG_A_KEY) as SupportedLang | null) ??
        DEFAULT_LANG_A,
      langB:
        (window.localStorage.getItem(LANG_B_KEY) as SupportedLang | null) ??
        DEFAULT_LANG_B,
    };
  } catch {
    return { enabled: false, langA: DEFAULT_LANG_A, langB: DEFAULT_LANG_B };
  }
}

function read(): TranslateModeState {
  const next = readRaw();
  if (
    next.enabled !== cached.enabled ||
    next.langA !== cached.langA ||
    next.langB !== cached.langB
  ) {
    cached = next;
  }
  return cached;
}

/** Synchronous, non-reactive read for the TTS/translate call path - mirrors
 *  `readStoredGender()`. */
export function readTranslateMode(): TranslateModeState {
  return read();
}

function write(state: TranslateModeState): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, state.enabled ? "1" : "0");
    window.localStorage.setItem(LANG_A_KEY, state.langA);
    window.localStorage.setItem(LANG_B_KEY, state.langB);
  } catch {
    // ignore - private mode / storage disabled; in-memory state still works
  }
  cached = state;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENABLED_KEY || e.key === LANG_A_KEY || e.key === LANG_B_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// Built lazily, not as a module constant: the defaults are configured after
// this module is evaluated, so a frozen literal would pin the pre-config pair.
// Memoised because getServerSnapshot has the same stable-reference requirement
// as getSnapshot (see the note on `cached` above) - a fresh object per call
// loops forever.
let serverCached: TranslateModeState | null = null;
function serverSnapshot(): TranslateModeState {
  if (serverCached === null) {
    serverCached = { enabled: false, langA: DEFAULT_LANG_A, langB: DEFAULT_LANG_B };
  }
  return serverCached;
}

export function useTranslateMode(): {
  enabled: boolean;
  langA: SupportedLang;
  langB: SupportedLang;
  setEnabled: (v: boolean) => void;
  setLangA: (lang: SupportedLang) => void;
  setLangB: (lang: SupportedLang) => void;
  swapLangs: () => void;
} {
  const state = useSyncExternalStore<TranslateModeState>(
    subscribe,
    read,
    serverSnapshot,
  );

  const setEnabled = useCallback((v: boolean) => {
    write({ ...read(), enabled: v });
    emit();
  }, []);

  // Picking the same language already on the other side swaps them instead
  // of leaving an invalid A===B pair - simpler than disabling the option in
  // one <select> based on the other's live value.
  const setLangA = useCallback((lang: SupportedLang) => {
    const cur = read();
    write({ ...cur, langA: lang, langB: lang === cur.langB ? cur.langA : cur.langB });
    emit();
  }, []);

  const setLangB = useCallback((lang: SupportedLang) => {
    const cur = read();
    write({ ...cur, langB: lang, langA: lang === cur.langA ? cur.langB : cur.langA });
    emit();
  }, []);

  const swapLangs = useCallback(() => {
    const cur = read();
    write({ ...cur, langA: cur.langB, langB: cur.langA });
    emit();
  }, []);

  return {
    enabled: state.enabled,
    langA: state.langA,
    langB: state.langB,
    setEnabled,
    setLangA,
    setLangB,
    swapLangs,
  };
}
