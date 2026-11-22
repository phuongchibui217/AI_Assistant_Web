import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { readDemoStore } from "@/lib/server/demo-store";
import { kbUploadPath } from "@/lib/server/kb-uploads";
import { hasLoginSession } from "@/lib/server/login-sessions";
import { resolveFilenameToUrl } from "@/lib/server/rag-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const file = readDemoStore().files.find((item) => String(item.id) === params.id && !item.deleted);
  const missing = () => Response.json({ error: "Original file unavailable" }, { status: 404 });
  if (!file) return missing();
  const source = file.uploadKey ? kbUploadPath(file.uploadKey) : null;
  const filename = encodeURIComponent(file.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
  const headers = {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${filename}`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (!source) {
    if (file.uploadKey) return missing();
    if (/^OCR_.*\.txt$/i.test(file.filename) && file.rawContent) {
      return new Response(file.rawContent, { headers });
    }
    // Older demo records saved metadata only. Use the real indexed original if available.
    try {
      const signal = AbortSignal.timeout(6_000);
      const signed = await resolveFilenameToUrl(`${file.folder}/${file.filename}`, signal) ??
        await resolveFilenameToUrl(file.filename, signal);
      if (!signed) return missing();
      const original = await fetch(signed, { cache: "no-store", signal });
      if (original.ok && original.body) return new Response(original.body, { headers });
    } catch {
      // The local demo can run without the indexing service.
    }
    return missing();
  }

  const handle = await open(source, "r").catch(() => null);
  if (!handle) return missing();
  try {
    const stats = await handle.stat();
    return new Response(Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, {
      headers: { ...headers, "content-length": String(stats.size) },
    });
  } catch (error) {
    await handle.close();
    console.error("[KB files] Could not read original:", error);
    return Response.json({ error: "Original file unavailable" }, { status: 500 });
  }
}
