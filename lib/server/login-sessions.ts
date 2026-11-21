import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export type LoginRole = "admin" | "client";

const sessionCookies = {
  admin: "ai_assistant_admin_session",
  client: "ai_assistant_client_session",
} as const;
const sessionLifetime = 60 * 60;
type Session = { role: LoginRole; expiresAt: number };

// The demo runs in one Next.js process. Keep sessions across dev recompiles.
const sessionStore = globalThis as typeof globalThis & {
  assistantLoginSessions?: Map<string, Session>;
};
const sessions = sessionStore.assistantLoginSessions ??= new Map();

export function hasLoginSession(role: LoginRole): boolean {
  const token = cookies().get(sessionCookies[role])?.value;
  const session = token ? sessions.get(token) : undefined;
  return !!session && session.role === role && session.expiresAt > Date.now();
}

export function startLoginSession(role: LoginRole): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }

  const cookieStore = cookies();
  const cookieName = sessionCookies[role];
  const previous = cookieStore.get(cookieName)?.value;
  const token = randomBytes(32).toString("base64url");
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionLifetime,
  });

  sessions.set(token, { role, expiresAt: now + sessionLifetime * 1000 });
  if (previous && sessions.get(previous)?.role === role) sessions.delete(previous);
}

export function endLoginSession(role: LoginRole): void {
  const cookieStore = cookies();
  const cookieName = sessionCookies[role];
  const token = cookieStore.get(cookieName)?.value;
  cookieStore.delete(cookieName);
  if (token && sessions.get(token)?.role === role) sessions.delete(token);
}
