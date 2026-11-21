import { NextResponse } from "next/server";

import { login, resolveFilenameToId, RAG_BASE } from "@/lib/server/file-resolve";

/**
 * Serve a cited file as PDF for the in-app iframe viewer, proxied from the
 * rag-service so backend credentials and blob storage stay server-side. PDFs
 * pass through; PPT / Word / Excel are converted (and cached) on the backend.
 *
 *   GET /api/file-preview-pdf?name=<filename>
 *   200 application/pdf
 *   404 not in KB index
 *   415 not previewable (client falls back to opening the file URL)
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filename = url.searchParams.get("name");

  if (!filename) {
    return NextResponse.json({ error: "Missing 'name' param" }, { status: 400 });
  }

  try {
    const id = await resolveFilenameToId(filename);
    if (id == null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const token = await login();
    const res = await fetch(`${RAG_BASE}/api/files/${id}/preview-pdf`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `preview-pdf ${res.status}` }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "application/pdf", "cache-control": "max-age=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/file-preview-pdf]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
