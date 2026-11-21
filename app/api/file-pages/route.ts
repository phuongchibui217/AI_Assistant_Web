import { NextResponse } from "next/server";

import { login, resolveFilenameToId, RAG_BASE } from "@/lib/server/file-resolve";

/**
 * Resolve a citation filename to its PDF page metadata: page count, the page
 * that best matches the citation excerpt, and per-page dimensions. The Unity /
 * web viewer uses this to pre-size scroll slots and jump to the matched page.
 *
 *   GET /api/file-pages?name=<filename>&content=<excerpt>
 *   200 { pages, start_page, dims: [{w,h}] }
 *   404 not in KB index
 *   415 not a PDF (client falls back to opening the file URL)
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filename = url.searchParams.get("name");
  const content = url.searchParams.get("content") ?? "";

  if (!filename) {
    return NextResponse.json({ error: "Missing 'name' param" }, { status: 400 });
  }

  try {
    const id = await resolveFilenameToId(filename);
    if (id == null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const token = await login();
    const qs = content ? `?content=${encodeURIComponent(content)}` : "";
    const res = await fetch(`${RAG_BASE}/api/files/${id}/page-info${qs}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `page-info ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/file-pages]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
