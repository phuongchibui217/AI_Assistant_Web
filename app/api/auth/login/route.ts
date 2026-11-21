import { createHash, timingSafeEqual } from "node:crypto";

import { verifyCredential } from "@/lib/server/htpasswd-auth";
import { startLoginSession } from "@/lib/server/login-sessions";

export const runtime = "nodejs";

function verifyAdminCredential(username: string, password: string): boolean {
  const demoDefault = process.env.NODE_ENV === "development" ? "admin" : undefined;
  const expectedUsername = process.env.ADMIN_USERNAME || demoDefault;
  const expectedPassword = process.env.ADMIN_PASSWORD || demoDefault;
  if (!expectedUsername || !expectedPassword || username !== expectedUsername) return false;

  const actualHash = createHash("sha256").update(password).digest();
  const expectedHash = createHash("sha256").update(expectedPassword).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return Response.json({ error: "Expected JSON" }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  const { username, password, role = "client" } = body ?? {};
  if (
    typeof username !== "string" || typeof password !== "string" ||
    (role !== "admin" && role !== "client")
  ) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = role === "admin"
    ? verifyAdminCredential(username, password)
    : verifyCredential(username, password);
  if (!valid) return Response.json({ error: "Invalid credentials" }, { status: 401 });

  startLoginSession(role);
  return new Response(null, { status: 204 });
}
