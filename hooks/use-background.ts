"use client";

import { useEffect, useState } from "react";

import { DEFAULT_BACKGROUND, fetchBackgrounds } from "@/lib/backgrounds";

/**
 * Resolves the single scene background the admin selected (issue 6 rework). The
 * `b`-key cycling is gone: the admin picks one background and every client shows
 * it.
 *
 * Resolution order:
 *   1. the admin-selected `activeId`, if it still exists in the list
 *   2. otherwise the first available background (e.g. active one was deleted)
 *   3. otherwise `null` (storage/list unreachable) - callers render a plain
 *      black backdrop in this case instead of a static decoy scene.
 *
 * `src` starts `null` (before `loaded`, and while the fetch above is in
 * flight) so callers show black instead of flashing a default scene that then
 * swaps to the real admin-selected background.
 *
 * `activeId` / `loaded` come from `useClientSettings` so the settings are
 * fetched once and shared.
 */
export function useBackground(
  activeId: string | null,
  loaded: boolean,
): { src: string | null } {
  const [src, setSrc] = useState<string | null>(DEFAULT_BACKGROUND);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    (async () => {
      const list = await fetchBackgrounds();
      if (cancelled) return;
      const match = activeId ? list.find((b) => b.id === activeId) : undefined;
      if (match) setSrc(match.url);
      else if (list.length > 0) setSrc(list[0].url);
      else setSrc(DEFAULT_BACKGROUND);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, loaded]);

  return { src };
}
