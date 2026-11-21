import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  if (hasLoginSession("admin")) redirect("/admin");
  return <LoginForm role="admin" />;
}
