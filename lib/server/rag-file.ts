/**
 * Shared helpers for authenticating against the RAG service and resolving
 * a citation filename to a signed Azure Blob Storage URL.
 *
 * Extracted from app/api/file-url/route.ts so the same auth can be reused
 * by the file-content proxy route.
 */

const BASE = process.env.RAG_SERVICE_URL ?? "http://127.0.0.1";
const USER = process.env.RAG_SERVICE_USER ?? "admin";
const PASS = process.env.RAG_SERVICE_PASS ?? "admin";

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

export async function resolveFilenameToUrl(filename: string): Promise<string | null> {
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
  if (!match) return null;

  const urlRes = await fetch(`${BASE}/api/files/${match.id}/url`, {
    headers,
    cache: "no-store",
  });
  if (!urlRes.ok) throw new Error(`file url failed: ${urlRes.status}`);
  const urlJson = (await urlRes.json()) as { url?: string };
  return urlJson.url ?? null;
}
