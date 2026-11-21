import { NextResponse } from "next/server";

import { getClientSettings, saveClientSettings } from "@/lib/server/client-settings";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const settings = await getClientSettings();
  return NextResponse.json(settings, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const updated = await saveClientSettings(body);
    return NextResponse.json(updated, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[API client-settings] save failed:", err);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 },
    );
  }
}
