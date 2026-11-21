import { NextResponse } from "next/server";
import { resolveFilenameToUrl } from "@/lib/server/rag-file";

/**
 * Resolve a citation filename to a signed Azure Blob URL.
 * Auth and resolution logic live in lib/server/rag-file.ts.
 *
 * Returns JSON `{ url }` or (with `?redirect=1`) issues a 302 redirect.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filename = url.searchParams.get("name");
  const wantRedirect = url.searchParams.get("redirect") === "1";

  if (!filename) {
    return NextResponse.json({ error: "Missing 'name' param" }, { status: 400 });
  }

  try {
    const resolved = await resolveFilenameToUrl(filename);
    if (!resolved) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (wantRedirect) {
      return NextResponse.redirect(resolved, 302);
    }
    return NextResponse.json({ url: resolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/file-url]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
