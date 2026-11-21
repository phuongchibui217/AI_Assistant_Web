import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getClientSettings } from "@/lib/server/client-settings";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const dynamic = "force-dynamic";

export default async function ClientLoginPage() {
  const { auth_enabled } = await getClientSettings();
  if (!auth_enabled || hasLoginSession("client")) redirect("/");
  return <LoginForm role="client" />;
}
