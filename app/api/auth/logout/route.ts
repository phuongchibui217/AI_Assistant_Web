import { endLoginSession } from "@/lib/server/login-sessions";

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return Response.json({ error: "Expected JSON" }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  const role = body?.role;
  if (role !== "admin" && role !== "client") {
    return Response.json({ error: "Invalid session type" }, { status: 400 });
  }

  try {
    endLoginSession(role);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[Logout] Failed to end session:", error);
    return Response.json({ error: "Logout failed. Please try again." }, { status: 500 });
  }
}
