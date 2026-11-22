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

    if (Array.isArray(patch.files)) {
      // A tab may have loaded its snapshot before another uploaded originals.
      const stored = readDemoStore().files.filter((file) => file.uploadKey);
      const incoming = patch.files;
      const storedById = new Map(stored.map((file) => [file.id, file]));
      const incomingIds = new Set(incoming.map((file) => file.id));
      patch.files = [
        ...incoming.map((update) => {
          const file = storedById.get(update.id);
          if (!file) return update;
          if (update.uploadKey !== file.uploadKey) return file;
          return { ...file, status: update.status, updated: update.updated, deleted: file.deleted || update.deleted };
        }),
        ...stored.filter((file) => !incomingIds.has(file.id)),
      ];
    }

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
