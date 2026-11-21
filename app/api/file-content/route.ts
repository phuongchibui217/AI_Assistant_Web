import { NextResponse } from "next/server";
import { readDemoStore } from "@/lib/server/demo-store";
import { resolveFilenameToUrl } from "@/lib/server/rag-file";

/**
 * Proxy a KB file through the server so the browser receives it from our
 * own origin. For HTML files, a `<base target="_blank">` tag is injected so
 * that every link in the document opens in a new browser tab instead of
 * navigating within the citation popup iframe.
 *
 * Non-HTML files (PDF, images, text) are streamed through without modification.
 *
 * Query params:
 *   name  – filename / storage key as stored in the RAG service
 */
/**
 * Decode raw text bytes to a JS string, detecting the source encoding instead
 * of trusting a (usually absent) charset. Order:
 *   1. Honour a UTF-8 / UTF-16 BOM if present.
 *   2. Try strict UTF-8 - valid UTF-8 is unambiguous, so if it decodes without
 *      error the file really is UTF-8.
 *   3. Fall back to Shift_JIS (CP932) - the dominant legacy encoding for
 *      Japanese .txt files, and what invalid-UTF-8 bytes almost always are here.
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filename = url.searchParams.get("name");

  if (!filename) {
    return NextResponse.json({ error: "Missing 'name' param" }, { status: 400 });
  }

  const renderDemoDocPreview = (name: string): Response | null => {
    const store = readDemoStore();
    const base = name.split("/").pop()?.toLowerCase() ?? name.toLowerCase();
    const match = store.files.find(
      (f) => !f.deleted && (f.filename.toLowerCase() === base || `${f.folder}/${f.filename}`.toLowerCase() === name.toLowerCase()),
    );
    if (!match) return null;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(match.filename)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:28px auto;padding:0 20px;color:#1e293b;line-height:1.7}
h1{font-size:20px;margin:0 0 8px} .meta{font-size:12px;color:#64748b;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}
.content{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;font-size:14px}</style></head>
<body><h1>${esc(match.filename)}</h1><div class="meta">Folder: ${esc(match.folder)} • Size: ${esc(match.size)} • Updated: ${esc(match.updated)}</div>
<div class="content">${esc(match.rawContent || "Document indexed in Knowledge Base.")}</div></body></html>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  };

  try {
    const sasUrl = await resolveFilenameToUrl(filename);
    if (!sasUrl) {
      const demoRes = renderDemoDocPreview(filename);
      if (demoRes) return demoRes;
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const upstream = await fetch(sasUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const isHtml =
      contentType.toLowerCase().includes("html") || /\.html?$/i.test(filename);
    const isText =
      !isHtml &&
      (contentType.toLowerCase().startsWith("text/") ||
        /\.(txt|csv|md|log|json|xml|vtt|srt)$/i.test(filename));

    if (isHtml) {
      const raw = await upstream.text();
      // Inject <base> right after the opening <head> tag (or prepend if missing).
      // - href points to the SAS URL origin so relative assets still resolve.
      // - target="_blank" makes every link open in a new tab.
      const baseOrigin = (() => {
        try {
          const u = new URL(sasUrl);
          return `${u.protocol}//${u.host}`;
        } catch {
          return "";
        }
      })();
      const baseTag = `<base href="${baseOrigin}" target="_blank">`;
      const injected = /<head[\s>]/i.test(raw)
        ? raw.replace(/(<head[\s>][^>]*>)/i, `$1\n  ${baseTag}`)
        : `${baseTag}\n${raw}`;

      return new Response(injected, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (isText) {
      // Text files (typically Japanese .txt) arrive without a charset, so the
      // browser guesses one - on a JP-locale machine it falls back to Shift_JIS
      // and a UTF-8 file renders as mojibake (縺/ｼ/box garbage). Decode the bytes
      // ourselves with encoding detection and re-emit as UTF-8 with an explicit
      // charset so the browser never guesses.
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const text = decodeText(bytes);
      return new Response(text, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    // Other binary (PDF, images, ...): stream the upstream body unchanged.
    return new Response(upstream.body, {
      headers: {
        "content-type": contentType || "application/octet-stream",
      },
    });
  } catch (err) {
    const demoRes = renderDemoDocPreview(filename);
    if (demoRes) return demoRes;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/file-content]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
