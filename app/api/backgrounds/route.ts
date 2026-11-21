import { NextResponse } from "next/server";

import { readDemoStore } from "@/lib/server/demo-store";

export const dynamic = "force-dynamic";

const BASE = process.env.RAG_SERVICE_URL ?? "http://127.0.0.1";

type RagBackground = { id: string; name: string };

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${BASE}/api/ai/backgrounds`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (res.ok) {
      const json = (await res.json()) as { backgrounds?: RagBackground[] };
      if (json.backgrounds && json.backgrounds.length > 0) {
        const backgrounds = json.backgrounds.map((b) => ({
          id: b.id,
          name: b.name,
          url: `/api/backgrounds/${encodeURIComponent(b.id)}/raw`,
        }));
        return NextResponse.json({ backgrounds });
      }
    }
  } catch {
    // fallback to local demo store below
  }

  const store = readDemoStore();
  const backgrounds = store.backgrounds.map((b) => ({
    id: String(b.id),
    name: b.name,
    url: b.url,
  }));

  return NextResponse.json(
    { backgrounds },
    { headers: { "cache-control": "no-store" } },
  );
}
