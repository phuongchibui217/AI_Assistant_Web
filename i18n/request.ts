import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { getClientSettings } from "@/lib/server/client-settings";

export const LOCALES = ["vi", "ja", "en", "zh-TW"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

function asLocale(value: string | undefined, fallback: Locale): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : fallback;
}

// No URL prefix - locale comes from a cookie written by the LangSwitcher.
// When the visitor has no cookie yet (first visit) we fall back to the
// admin-configured per-deployment default, so a Taiwan deployment opens in
// zh-TW without every visitor having to switch manually. The visitor's own
// cookie always wins once they have chosen. If the settings fetch fails it
// yields DEFAULT_LOCALE, same as before this existed.
export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const deploymentDefault = cookieLocale
    ? DEFAULT_LOCALE
    : asLocale((await getClientSettings()).default_locale, DEFAULT_LOCALE);
  const locale = asLocale(cookieLocale, deploymentDefault);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
