import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hasLoginSession } from "@/lib/server/login-sessions";

import {
  AdminClient,
  type Lang,
  type Tab,
} from "./admin-client";

export const dynamic = "force-dynamic";

const VALID_TABS: readonly Tab[] = [
  "dashboard",
  "assistants",
  "stances",
  "knowledge-base",
  "lexemes",
  "chat-history",
  "backgrounds",
  "settings",
];

const VALID_LANGS: readonly Lang[] = ["vi", "en", "ja", "zh"];

export default function AdminPage({
  searchParams,
}: {
  searchParams: { tab?: string; lang?: string };
}) {
  if (!hasLoginSession("admin")) redirect("/admin/login");

  const tabParam = searchParams.tab as Tab | undefined;
  const initialTab: Tab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "dashboard";

  const langParam = searchParams.lang as Lang | undefined;
  const cookieLang = cookies().get("admin_lang")?.value as Lang | undefined;
  const initialLang: Lang =
    langParam && VALID_LANGS.includes(langParam)
      ? langParam
      : cookieLang && VALID_LANGS.includes(cookieLang)
      ? cookieLang
      : "en";

  return <AdminClient initialTab={initialTab} initialLang={initialLang} />;
}
