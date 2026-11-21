import { NextResponse } from "next/server";

import { login, resolveFilenameToId, RAG_BASE } from "@/lib/server/file-resolve";

/**
 * Render one PDF page of a cited file to PNG, proxied from the rag-service so
 * the backend credentials and blob storage stay server-side.
 *
 *   GET /api/file-page?name=<filename>&page=<1-based>&dpi=150
 *   200 image/png
 *   404 not found / page out of range
 *   415 not a PDF
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filename = url.searchParams.get("name");
  const page = url.searchParams.get("page") ?? "1";
  const dpi = url.searchParams.get("dpi") ?? "150";

  if (!filename) {
    return NextResponse.json({ error: "Missing 'name' param" }, { status: 400 });
  }

  try {
    const id = await resolveFilenameToId(filename);
    if (id == null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const token = await login();
    const res = await fetch(
      `${RAG_BASE}/api/files/${id}/page/${encodeURIComponent(page)}?dpi=${encodeURIComponent(dpi)}`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `page ${res.status}` }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "max-age=3600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/file-page]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
