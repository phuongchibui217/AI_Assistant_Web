import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { readDemoStore, writeDemoStore, type DemoStoreState } from "@/lib/server/demo-store";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const dynamic = "force-dynamic";

function stateResponse(state: DemoStoreState): Response {
  const { clientPassword, clientPasswordHash, ...data } = state;
  return NextResponse.json({ ...data, hasClientPassword: Boolean(clientPasswordHash || clientPassword) }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return stateResponse(readDemoStore());
}

export async function PUT(req: Request): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Partial<DemoStoreState>;
    const { clientUsername, clientPassword, clientPasswordHash, ...patch } = body;

    if (clientUsername !== undefined || clientPassword !== undefined || clientPasswordHash !== undefined) {
      if (
        typeof clientUsername !== "string" || !clientUsername.trim() ||
        typeof clientPassword !== "string" || !clientPassword.trim() ||
        Buffer.byteLength(clientPassword, "utf8") > 72
      ) {
        return NextResponse.json({ error: "Invalid client credentials" }, { status: 400 });
      }

      const passwordHash = await bcrypt.hash(clientPassword, 10);
      const updated = writeDemoStore({
        ...patch,
        clientUsername: clientUsername.trim(),
        clientPasswordHash: passwordHash,
        clientPassword: undefined,
      }, { throwOnError: true });
      return stateResponse(updated);
    }

    return stateResponse(writeDemoStore(patch));
  } catch (err) {
    console.error("[API admin/state] save failed:", err);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
