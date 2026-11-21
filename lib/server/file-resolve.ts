// Shared server-side helpers for the citation page-image proxy routes
// (/api/file-pages, /api/file-page). Logs into the rag-api with service
// credentials and resolves a citation filename to its numeric file id, so the
// browser never sees the backend credentials.
//
// The legacy /api/file-url route keeps its own self-contained copy of the
// login/resolve logic (it resolves to a SAS URL, not an id) - left untouched.

const BASE = process.env.RAG_SERVICE_URL ?? "http://127.0.0.1";
const USER = process.env.RAG_SERVICE_USER ?? "wise";
const PASS = process.env.RAG_SERVICE_PASS ?? "wise";

type AuthCache = { token: string; expiresAt: number };
let authCache: AuthCache | null = null;

export async function login(): Promise<string> {
  const now = Date.now();
  if (authCache && authCache.expiresAt > now + 60_000) return authCache.token;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER, password: PASS }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth login failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("no access_token in login response");
  const ttlMs = (json.expires_in ?? 3600) * 500;
  authCache = { token: json.access_token, expiresAt: now + ttlMs };
  return authCache.token;
}

type IngestDateCache = { map: Record<string, string>; expiresAt: number };
let ingestDateCache: IngestDateCache | null = null;

/**
 * Map of every KB file's name -> its KB-registration date (YYYY-MM-DD), keyed
 * by filename, original_name and storage_key so a lookup by any of them hits.
 * Used to answer "最新のデータはいつ" with the ingest date. Cached 60s because
 * the file set changes rarely and this runs on every RAG answer.
 */
export async function getIngestDateMap(): Promise<Record<string, string>> {
  const now = Date.now();
  if (ingestDateCache && ingestDateCache.expiresAt > now) return ingestDateCache.map;

  const token = await login();
  const res = await fetch(`${BASE}/api/files`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`file list failed: ${res.status}`);
  const list = (await res.json()) as {
    files: Array<{
      filename: string;
      original_name?: string;
      storage_key?: string;
      created_at?: string;
    }>;
  };

  const map: Record<string, string> = {};
  for (const f of list.files) {
    if (!f.created_at) continue;
    const day = f.created_at.slice(0, 10); // ISO -> YYYY-MM-DD
    for (const key of [f.filename, f.original_name, f.storage_key]) {
      if (key) map[key] = day;
    }
  }
  ingestDateCache = { map, expiresAt: now + 60_000 };
  return map;
}

export async function resolveFilenameToId(filename: string): Promise<number | null> {
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };

  const listRes = await fetch(`${BASE}/api/files`, { headers, cache: "no-store" });
  if (!listRes.ok) throw new Error(`file list failed: ${listRes.status}`);
  const list = (await listRes.json()) as {
    files: Array<{ id: number; filename: string; original_name?: string; storage_key?: string }>;
  };
  const match = list.files.find(
    (f) =>
      f.filename === filename ||
      f.original_name === filename ||
      f.storage_key === filename ||
      f.storage_key?.endsWith(`/${filename}`),
  );
  return match?.id ?? null;
}

export const RAG_BASE = BASE;
