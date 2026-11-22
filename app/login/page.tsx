import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getClientSettings } from "@/lib/server/client-settings";

export const dynamic = "force-dynamic";

export default async function ClientLoginPage() {
  const { auth_enabled } = await getClientSettings();
  if (!auth_enabled) redirect("/");

  return <LoginForm role="client" />;
}