import { redirect } from "next/navigation";

import { getClientSettings } from "@/lib/server/client-settings";
import { verifyEmbedKey } from "@/lib/server/embed-key";
import { hasLoginSession } from "@/lib/server/login-sessions";

import { HomeClient } from "./home-client";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { embed?: string; key?: string };
}) {
  const {
    auth_enabled,
    default_mic_lang,
    default_translate_lang_a,
    default_translate_lang_b,
  } = await getClientSettings();
  // Embed mode (`?embed=1`, injected by /embed.js on a third-party site) is
  // authorized by an admin-issued embed key rather than a user login - the host
  // page owns access, and a cross-origin iframe can't reliably persist the login
  // token. The key is validated SERVER-SIDE (never reaches the browser via the
  // public settings endpoint); a valid key turns the login gate off, an invalid
  // or missing key refuses to load (fail-closed - no keyless guest access to the
  // paid chat/TTS APIs).
  const isEmbed = searchParams.embed === "1";
  const embedOk = isEmbed ? await verifyEmbedKey(searchParams.key) : false;
  if (isEmbed && !embedOk) {
    return (
      <main className="grid h-screen w-screen place-items-center bg-black px-6 text-center text-white">
        <p className="max-w-sm text-sm text-white/70">
          This AI Assistant embed is not authorized. Check the embed key in your
          script tag. / この AI Assistant 埋め込みは許可されていません。埋め込みキーをご確認ください。
        </p>
      </main>
    );
  }
  const loginRequired = auth_enabled && !embedOk;
  if (loginRequired && !hasLoginSession("client")) redirect("/login");

  // The language defaults are read here on the SERVER, not via
  // useClientSettings(), for the same reason as auth_enabled above: the hooks
  // that consume them seed their state in a useState initializer on first
  // render, so a client-side fetch would resolve too late and the visitor
  // would see the wrong language flip.
  return (
    <HomeClient
      canSignOut={loginRequired}
      defaultMicLang={default_mic_lang}
      defaultTranslateLangA={default_translate_lang_a}
      defaultTranslateLangB={default_translate_lang_b}
    />
  );
}
