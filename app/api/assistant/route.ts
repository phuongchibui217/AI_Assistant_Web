import { NextResponse } from "next/server";

import { getActiveAssistant } from "@/lib/server/active-assistant";

// Without this the admin's persona/stance edits get masked by Next's
// default GET cache until the dev server restarts.
export const dynamic = "force-dynamic";

/**
 * Client proxy for the currently active assistant persona. The actual
 * upstream lives on the admin RAG service (`/api/assistants`) which can
 * only be reached server-side because RAG_SERVICE_URL never ships in the
 * browser bundle. The web client calls this route once on boot to pick up
 * `display_name` + `greeting`; the system_instruction stays server-side.
 */
export async function GET(): Promise<Response> {
  const assistant = await getActiveAssistant();
  return NextResponse.json(
    {
      display_name: assistant?.display_name ?? null,
      greeting: assistant?.greeting ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
