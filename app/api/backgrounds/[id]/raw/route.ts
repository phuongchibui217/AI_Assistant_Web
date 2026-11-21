// Streams an admin-registered background image from the RAG service through our
// own origin, so the browser loads it without reaching the RAG host directly.
const BASE = process.env.RAG_SERVICE_URL ?? "http://127.0.0.1";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const res = await fetch(
    `${BASE}/api/ai/backgrounds/${encodeURIComponent(params.id)}/raw`,
    { cache: "no-store" },
  );
  if (!res.ok) return new Response("Not found", { status: 404 });

  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
    },
  });
}
