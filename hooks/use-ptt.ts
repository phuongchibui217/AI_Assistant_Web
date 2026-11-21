"use client";

import { useEffect, useRef } from "react";

type PttOptions = {
  /** `KeyboardEvent.code` that triggers the hold (e.g. "KeyM"). */
  code: string;
  onPress: () => void | Promise<void>;
  onRelease: () => void;
  /** Disable the PTT shortcut entirely (e.g. before the session is ready). */
  enabled?: boolean;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA"]);

/** True while focus is on ANY text-editable element - the main composer
 *  input, the Messenger-style edit-message textarea, or any future one -
 *  so typing the shortcut's letter there never gets captured as PTT. A
 *  single hardcoded ref (the previous approach) only covered the composer:
 *  fixing a typo in the edit-message textarea (a separate element with its
 *  own inline ref) still triggered the mic because it never matched that
 *  one ref (client feedback 2026-08-13). */
function isEditableFocused(): boolean {
  const el = document.activeElement;
  if (el === null) return false;
  return EDITABLE_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable;
}

/**
 * Push-to-talk on holding a given key. Suppressed when focus is on any text
 * input/textarea so typing that key doesn't capture the mic.
 */
export function useKeyPtt({ code, onPress, onRelease, enabled = true }: PttOptions): void {
  const downRef = useRef(false);
  // Pin the latest callbacks so the effect only re-attaches when `enabled`/
  // `code` flip - re-binding on every parent rerender would drop key events.
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (!enabled) return;

    const handleDown = (e: KeyboardEvent) => {
      if (e.code !== code || e.repeat || downRef.current) return;
      if (isEditableFocused()) return;
      downRef.current = true;
      e.preventDefault();
      void onPressRef.current();
    };

    const handleUp = (e: KeyboardEvent) => {
      if (e.code !== code || !downRef.current) return;
      downRef.current = false;
      onReleaseRef.current();
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, [code, enabled]);
}
