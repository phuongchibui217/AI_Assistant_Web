"use client";

import { useEffect, useState } from "react";

/**
 * One-shot fetch of the admin-managed active assistant on mount. Returns
 * `display_name` + `greeting` overrides, or `null` for either field while
 * the request is in flight / has failed - callers should fall back to the
 * compile-time persona constants so the avatar never renders nameless.
 */

export type ActiveAssistantClient = {
  display_name: string | null;
  greeting: string | null;
  /** True once the initial fetch has settled (either with data or after a
   *  swallowed failure). Use to gate the initial greeting so we don't render
   *  the i18n fallback first and then flip when the admin value arrives. */
  loaded: boolean;
};

export function useActiveAssistant(): ActiveAssistantClient {
  const [data, setData] = useState<ActiveAssistantClient>({
    display_name: null,
    greeting: null,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assistant", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled)
            setData((d) => ({ ...d, loaded: true }));
          return;
        }
        const json = (await res.json()) as {
          display_name?: string | null;
          greeting?: string | null;
        };
        if (cancelled) return;
        setData({
          display_name: json.display_name ?? null,
          greeting: json.greeting ?? null,
          loaded: true,
        });
      } catch {
        if (!cancelled) setData((d) => ({ ...d, loaded: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
