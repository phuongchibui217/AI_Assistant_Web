/**
 * Server-side validation of an embed key against the admin-issued key
 * (rag `POST /api/embed-key/verify`). Called from the embed boot in
 * `app/page.tsx` so the raw key is never shipped to the browser via the public
 * settings endpoint - only a yes/no crosses back.
 *
 * Fail-closed: no key, a backend error, or `valid !== true` all return false,
 * so the embed refuses to load rather than granting keyless guest access to
 * the (paid) chat/TTS APIs.
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

export async function verifyEmbedKey(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  try {
    const res = await fetch(`${RAG_SERVICE_URL}/api/embed-key/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { valid?: unknown };
    return json.valid === true;
  } catch {
    return false;
  }
}
