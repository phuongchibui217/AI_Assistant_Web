/**
 * Server-side fetch + cache for admin-managed client settings
 * (admin → /api/app-setting or local persistence).
 */

import fs from "fs";
import path from "path";

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

export type ClientSettings = {
  voice_enabled: boolean;
  avatar_enabled: boolean;
  locked: boolean;
  /** Admin-selected background id (GCS object name), or null = none picked. */
  active_background: string | null;
  /** Whether visitors must sign in to open the standalone web client. */
  auth_enabled: boolean;
  default_locale: string;
  default_mic_lang: string;
  default_translate_lang_a: string;
  default_translate_lang_b: string;
};

const DEFAULTS: ClientSettings = {
  voice_enabled: true,
  avatar_enabled: true,
  locked: true,
  active_background: null,
  auth_enabled: false,
  default_locale: "en",
  default_mic_lang: "locale",
  default_translate_lang_a: "en",
  default_translate_lang_b: "en",
};

const LOCAL_SETTINGS_FILE = path.join(process.cwd(), "local-settings.json");

function readLocalSettings(): Partial<ClientSettings> {
  try {
    if (fs.existsSync(LOCAL_SETTINGS_FILE)) {
      const data = fs.readFileSync(LOCAL_SETTINGS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn("[ClientSettings] Failed to read local settings:", e);
  }
  return {};
}

function writeLocalSettings(settings: ClientSettings): void {
  try {
    fs.writeFileSync(LOCAL_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.warn("[ClientSettings] Failed to write local settings:", e);
  }
}

const CACHE_TTL_MS = 60_000;
let cached: { value: ClientSettings; at: number } | null = null;
let inflight: Promise<ClientSettings> | null = null;

async function fetchOnce(): Promise<ClientSettings> {
  const local = readLocalSettings();
  const base = { ...DEFAULTS, ...local };

  try {
    const res = await fetch(`${RAG_SERVICE_URL}/api/app-setting`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return base;
    const json = (await res.json()) as {
      client_settings_locked?: unknown;
      assistant_avatar_enabled?: unknown;
      assistant_voice_enabled?: unknown;
      active_background?: unknown;
      client_auth_enabled?: unknown;
      default_locale?: unknown;
      default_mic_lang?: unknown;
      default_translate_lang_a?: unknown;
      default_translate_lang_b?: unknown;
    };
    const str = (v: unknown, fallback: string) =>
      typeof v === "string" && v ? v : fallback;
    return {
      voice_enabled:
        typeof json.assistant_voice_enabled === "boolean"
          ? json.assistant_voice_enabled
          : base.voice_enabled,
      avatar_enabled:
        typeof json.assistant_avatar_enabled === "boolean"
          ? json.assistant_avatar_enabled
          : base.avatar_enabled,
      locked:
        typeof json.client_settings_locked === "boolean"
          ? json.client_settings_locked
          : base.locked,
      active_background:
        typeof json.active_background === "string" && json.active_background
          ? json.active_background
          : base.active_background,
      auth_enabled:
        typeof json.client_auth_enabled === "boolean"
          ? json.client_auth_enabled
          : base.auth_enabled,
      default_locale: str(json.default_locale, base.default_locale),
      default_mic_lang: str(json.default_mic_lang, base.default_mic_lang),
      default_translate_lang_a: str(
        json.default_translate_lang_a,
        base.default_translate_lang_a,
      ),
      default_translate_lang_b: str(
        json.default_translate_lang_b,
        base.default_translate_lang_b,
      ),
    };
  } catch {
    return base;
  }
}

export async function getClientSettings(): Promise<ClientSettings> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = fetchOnce()
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function saveClientSettings(patch: Partial<ClientSettings>): Promise<ClientSettings> {
  const current = await getClientSettings();
  const updated: ClientSettings = {
    ...current,
    ...patch,
  };
  writeLocalSettings(updated);
  cached = { value: updated, at: Date.now() };

  // Sync to backend service if reachable
  try {
    await fetch(`${RAG_SERVICE_URL}/api/app-setting`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assistant_voice_enabled: updated.voice_enabled,
        assistant_avatar_enabled: updated.avatar_enabled,
        client_settings_locked: updated.locked,
        active_background: updated.active_background,
        client_auth_enabled: updated.auth_enabled,
        default_locale: updated.default_locale,
        default_mic_lang: updated.default_mic_lang,
        default_translate_lang_a: updated.default_translate_lang_a,
        default_translate_lang_b: updated.default_translate_lang_b,
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Offline upstream is safe; local-settings.json already stored
  }

  return updated;
}
