import type { LoginRole } from "@/lib/server/login-sessions";

const logoutEventKey = "ai_assistant_logout";

function showLogin(role: LoginRole): void {
  window.location.replace(role === "admin" ? "/admin/login" : "/login");
}

export async function logout(role: LoginRole): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error("Logout failed");

  try {
    if (role === "client") window.localStorage.removeItem("ai_assistant_client_token");
    window.localStorage.setItem(logoutEventKey, `${role}:${Date.now()}`);
  } catch {
    // Browser storage is only used to notify other tabs.
  }
  showLogin(role);
}

export function listenForLogout(role: LoginRole): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === logoutEventKey && event.newValue?.startsWith(`${role}:`)) showLogin(role);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
