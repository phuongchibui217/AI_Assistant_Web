"use client";

import { useEffect, useState } from "react";

/**
 * One-shot fetch of admin-managed client settings on mount. Mirrors
 * `useActiveAssistant`. Returns the three booleans + a `loaded` flag so
 * the shell can gate render / audio side-effects until the settings have
 * settled (defaults render fully-on, so a slow fetch is visually
 * indistinguishable from a successful default fetch).
 */

export type ClientSettingsClient = {
  voice_enabled: boolean;
  avatar_enabled: boolean;
  locked: boolean;
  active_background: string | null;
  auth_enabled: boolean;
  loaded: boolean;
};

const DEFAULTS: Omit<ClientSettingsClient, "loaded"> = {
  voice_enabled: true,
  avatar_enabled: true,
  locked: true,
  active_background: null,
  auth_enabled: false,
};

export function useClientSettings(): ClientSettingsClient {
  const [data, setData] = useState<ClientSettingsClient>({
    ...DEFAULTS,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client-settings", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setData((d) => ({ ...d, loaded: true }));
          return;
        }
        const json = (await res.json()) as {
          voice_enabled?: boolean;
          avatar_enabled?: boolean;
          locked?: boolean;
          active_background?: string | null;
          auth_enabled?: boolean;
        };
        if (cancelled) return;
        setData({
          voice_enabled:
            typeof json.voice_enabled === "boolean"
              ? json.voice_enabled
              : DEFAULTS.voice_enabled,
          avatar_enabled:
            typeof json.avatar_enabled === "boolean"
              ? json.avatar_enabled
              : DEFAULTS.avatar_enabled,
          locked:
            typeof json.locked === "boolean" ? json.locked : DEFAULTS.locked,
          active_background:
            typeof json.active_background === "string" && json.active_background
              ? json.active_background
              : null,
          auth_enabled:
            typeof json.auth_enabled === "boolean"
              ? json.auth_enabled
              : DEFAULTS.auth_enabled,
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
