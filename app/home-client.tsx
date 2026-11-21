"use client";

import dynamic from "next/dynamic";

// ssr:false keeps Three.js / the session socket out of the server bundle. This
// dynamic import must live in a Client Component.
const AppShell = dynamic(
  () => import("@/components/app-shell").then((m) => m.AppShell),
  { ssr: false },
);

export function HomeClient({
  canSignOut,
  defaultMicLang,
  defaultTranslateLangA,
  defaultTranslateLangB,
}: {
  canSignOut: boolean;
  defaultMicLang: string;
  defaultTranslateLangA: string;
  defaultTranslateLangB: string;
}) {
  return (
    <AppShell
      canSignOut={canSignOut}
      defaultMicLang={defaultMicLang}
      defaultTranslateLangA={defaultTranslateLangA}
      defaultTranslateLangB={defaultTranslateLangB}
    />
  );
}
