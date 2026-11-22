"use client";

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { AvatarCalibrator } from "@/components/avatar-calibrator";
import { AvatarGenderToggle } from "@/components/avatar-gender-toggle";
import { BottomBar } from "@/components/bottom-bar";
import { CalibrationOverlay } from "@/components/calibration-overlay";
import { ChatPanel } from "@/components/chat-panel";
import { InfoPanel } from "@/components/info-panel";
import { MobileChat } from "@/components/mobile-chat";
import { StatusIndicator } from "@/components/status-indicator";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { useAvatarVisibility } from "@/hooks/use-avatar-visibility";
import { useBackground } from "@/hooks/use-background";
import { useClientSettings } from "@/hooks/use-client-settings";
import { useGender } from "@/hooks/use-gender";
import { useGeminiSession } from "@/hooks/use-gemini-session";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useKeyPtt } from "@/hooks/use-ptt";
import { configureTranslateDefaults, useTranslateMode } from "@/hooks/use-translate-mode";
import type { Avatar } from "@/lib/avatar/avatar";
import { CHARACTERS } from "@/lib/avatar/characters";
import { SUPPORTED_LANGS, type SupportedLang } from "@/lib/lang-detect";
import { listenForLogout, logout } from "@/lib/client-auth";
import { AVATAR_NAME } from "@/lib/persona";

// The admin stores language codes as plain strings, so narrow them here at the
// boundary rather than trusting the API shape. Anything unrecognised falls back
// to the previous hardcoded default instead of poisoning the TTS/translate path.
function asSupportedLang(value: string, fallback: SupportedLang): SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value)
    ? (value as SupportedLang)
    : fallback;
}

// Lazy-load AvatarScene so Three.js is never bundled / executed on mobile.
// The desktop branch renders this only when showAvatar is true.
const AvatarScene = dynamic(
  () => import("@/components/avatar-scene").then((m) => m.AvatarScene),
  { ssr: false },
);

/**
 * Top-level client shell. Owns the session hook and wires it to the avatar,
 * chat panel, and bottom bar. AudioContext is resumed lazily on the first
 * mic / send action so the browser's user-gesture requirement is satisfied
 * without prompting the user explicitly.
 */
export function AppShell({
  canSignOut,
  defaultMicLang,
  defaultTranslateLangA,
  defaultTranslateLangB,
  cloudTranslationEnabled,
}: {
  canSignOut: boolean;
  defaultMicLang: string;
  defaultTranslateLangA: string;
  defaultTranslateLangB: string;
  cloudTranslationEnabled: boolean;
}) {
  // Seed the interpreter-mode pair BEFORE any hook below reads it. These are
  // module-level (not React state) because `readTranslateMode()` runs on the
  // per-turn TTS path, outside React - see use-translate-mode.ts. Assigning
  // from props here is idempotent, so a StrictMode double render is harmless.
  configureTranslateDefaults(
    asSupportedLang(defaultTranslateLangA, "ja"),
    asSupportedLang(defaultTranslateLangB, "en"),
  );
  const session = useGeminiSession(defaultMicLang, cloudTranslationEnabled);
  const textInputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations();
  const clientSettings = useClientSettings();
  const isMobile = useIsMobile();
  const background = useBackground(
    clientSettings.active_background,
    clientSettings.loaded,
  );
  const { gender, setGender, toggle: toggleGender } = useGender();
  const character = CHARACTERS[gender];
  const avatarName = gender === "male" ? t("avatarNameMale") : AVATAR_NAME;

  // User-side "text only" preference (orthogonal to the admin setting below) -
  // can only ever hide an avatar the admin already turned on, never force one
  // back on that the admin disabled.
  const { avatarVisible, setAvatarVisible, toggle: toggleAvatarVisible } =
    useAvatarVisibility();
  const translateMode = useTranslateMode();

  // The avatar follows the admin setting on every platform now: mobile renders
  // it full-screen with a translucent chat overlay (reverses the old #55
  // always-hidden-on-mobile rule). When the admin disables it, mobile falls
  // back to the lightweight messenger layout. Same fallback now also applies
  // when the user hides it themselves via the top-bar/header toggle.
  const showAvatar = clientSettings.avatar_enabled && avatarVisible;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const greetingRef = useRef<{ id: string; text: string } | null>(null);
  const connectedRef = useRef(false);
  const [avatar, setAvatar] = useState<Avatar | null>(null);

  useEffect(() => {
    if (canSignOut) return listenForLogout("client");
  }, [canSignOut]);

  const handleLogout = async () => {
    setLogoutFailed(false);
    setIsLoggingOut(true);
    try {
      await logout("client");
    } catch {
      setLogoutFailed(true);
      setIsLoggingOut(false);
    }
  };

  const handleAvatarReady = useCallback(
    (avatar: Avatar) => {
      setAvatar(avatar);
      session.bindAvatar(avatar);
      if (!connectedRef.current) {
        connectedRef.current = true;
        void session.connect();
      }
    },
    [session],
  );

  // When the avatar is not shown (admin-disabled OR mobile), AvatarScene never
  // mounts and its onReady callback never fires - so we have to drive the
  // connect ourselves once client settings have settled.
  useEffect(() => {
    if (!clientSettings.loaded) return;
    if (showAvatar) return;
    if (connectedRef.current) return;
    connectedRef.current = true;
    void session.connect();
  }, [clientSettings.loaded, showAvatar, session]);

  // Gate TTS at the source on the admin "voice_enabled" flag: when disabled we
  // never synthesize, so no Cloud/Azure TTS usage cost (vs the old volume-mute
  // which still paid to synthesize silent audio). Declarative + idempotent like
  // the avatar gate - both directions, re-enabling restores voice. The user's
  // manual volume button (toggleAudio) is separate and unaffected.
  useEffect(() => {
    if (!clientSettings.loaded) return;
    session.setTtsEnabled(clientSettings.voice_enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSettings.loaded, clientSettings.voice_enabled]);

  const greetingText = t("greeting", { name: avatarName });
  useEffect(() => {
    const greeting = greetingRef.current;
    if (!greeting && session.status === "ready") {
      greetingRef.current = { id: session.pushGreeting(greetingText), text: greetingText };
    } else if (greeting && greeting.text !== greetingText) {
      session.replaceModelText(greeting.id, greetingText);
      greeting.text = greetingText;
    }
  }, [greetingText, session]);

  // "M" hotkey (replaces the old Space PTT binding): identical to the mic
  // button now - both auto-send on release (client spec 2026-07-30).
  useKeyPtt({
    code: "KeyM",
    onPress: session.startTalk,
    onRelease: session.stopTalk,
    enabled: session.status === "ready" || session.status === "listening",
  });

  // Stop the mic only when the page actually becomes hidden. Using `blur`
  // is too aggressive (permission prompts and devtools focus can fire it).
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") session.stopTalk();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [session]);

  // Only grey out the input when there is no realistic path to send. Transient
  // states (`connecting`, `disconnected` between reconnect attempts) keep the
  // input enabled - `sendText` itself waits briefly for the socket to come
  // back. Without this gate the input was cycling on/off whenever the session
  // hopped through a reconnect (feedback item 22).
  const interactionDisabled =
    session.status === "idle" || session.status === "error";

  // Desktop ChatPanel doesn't otherwise see the mic state (BottomBar does) -
  // build the live-transcript-bubble prop here.
  const talking = session.micActive || session.recognizing;
  const micPreview = talking
    ? { text: session.draft, listening: session.micActive }
    : null;

  const logoutControl = canSignOut && (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={isLoggingOut} onClick={() => void handleLogout()}>
        {t("settings.logout")}
      </Button>
      {logoutFailed && <p role="alert" className="text-sm text-rose-300">{t("settings.logoutFailed")}</p>}
    </div>
  );

  // ── Mobile branch ───────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <MobileChat
          messages={session.messages}
          thinking={session.thinking}
          status={session.status}
          errorMessage={session.errorMessage}
          micActive={session.micActive}
          recognizing={session.recognizing}
          audioMuted={session.audioMuted}
          interactionDisabled={interactionDisabled}
          inputRef={textInputRef}
          draft={session.draft}
          onDraftChange={session.setDraft}
          micLang={session.micLang}
          onMicLangChange={session.setMicLang}
          showAvatar={showAvatar}
          avatarConfig={character}
          backgroundSrc={background.src}
          onAvatarReady={handleAvatarReady}
          onMicPressStart={() => void session.startTalk()}
          onMicPressEnd={session.stopTalk}
          onToggleAudio={session.toggleAudio}
          onSend={(text) => void session.sendText(text)}
          onSendSuggestion={(text) => void session.sendText(text)}
          onEditMessage={(id, text) => void session.editMessage(id, text)}
          onSkip={session.skip}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          avatarAdminEnabled={clientSettings.avatar_enabled}
          avatarVisible={avatarVisible}
          onToggleAvatarVisible={toggleAvatarVisible}
          gender={gender}
          onToggleGender={toggleGender}
          translateEnabled={translateMode.enabled}
          onToggleTranslateEnabled={() =>
            translateMode.setEnabled(!translateMode.enabled)
          }
          translateLangA={translateMode.langA}
          translateLangB={translateMode.langB}
          onTranslateLangAChange={translateMode.setLangA}
          onTranslateLangBChange={translateMode.setLangB}
          onSwapTranslateLangs={translateMode.swapLangs}
        />

        {/* Shared modals — mounted in app-shell so they overlay MobileChat */}
        <InfoPanel
          open={settingsOpen}
          title={t("settings.title")}
          onClose={() => setSettingsOpen(false)}
        >
          <AvatarGenderToggle gender={gender} onChange={setGender} />
          <p className="text-zinc-400">{t("settings.futureNote")}</p>
          {logoutControl}
        </InfoPanel>

        <InfoPanel
          open={helpOpen}
          title={t("help.title")}
          onClose={() => setHelpOpen(false)}
        >
          <p>{t("help.intro", { name: avatarName })}</p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-200">
            <li>{t("help.li1")}</li>
            <li>{t("help.li2")}</li>
            <li>{t("help.li3")}</li>
          </ul>
          <p className="text-zinc-400">{t("help.outro")}</p>
        </InfoPanel>
      </>
    );
  }

  // ── Desktop branch (unchanged) ──────────────────────────────────────────────
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {/* Background scene - admin-selected, resolved async by useBackground.
          Renders nothing (plain black, via the <main> bg-black above) until a
          real URL resolves, so the load never flashes a decoy default scene
          before swapping to the real one. */}
      {background.src && (
        <Image
          src={background.src}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      )}

      {clientSettings.loaded && showAvatar && (
        <AvatarScene onReady={handleAvatarReady} config={character} />
      )}
      {clientSettings.loaded && showAvatar && <CalibrationOverlay />}
      {/* Male design reference (full-interface ref.png), toggle with P. */}
      {clientSettings.loaded && showAvatar && (
        <CalibrationOverlay src="/ref.png" toggleKey="p" defaultDy={0} />
      )}
      {clientSettings.loaded && showAvatar && <AvatarCalibrator avatar={avatar} />}
      <ChatPanel
        messages={session.messages}
        onSendSuggestion={(text) => void session.sendText(text)}
        thinking={session.thinking}
        onEditMessage={(id, text) => void session.editMessage(id, text)}
        centered={!showAvatar}
        micPreview={micPreview}
      />
      <TopBar
        gender={gender}
        onGenderChange={setGender}
        avatarAdminEnabled={clientSettings.avatar_enabled}
        avatarVisible={avatarVisible}
        onToggleAvatarVisible={toggleAvatarVisible}
        translateEnabled={translateMode.enabled}
        onToggleTranslateEnabled={() =>
          translateMode.setEnabled(!translateMode.enabled)
        }
        translateLangA={translateMode.langA}
        translateLangB={translateMode.langB}
        onTranslateLangAChange={translateMode.setLangA}
        onTranslateLangBChange={translateMode.setLangB}
        onSwapTranslateLangs={translateMode.swapLangs}
      />
      <StatusIndicator status={session.status} error={session.errorMessage} />
      <BottomBar
        micActive={session.micActive}
        recognizing={session.recognizing}
        audioMuted={session.audioMuted}
        disabled={interactionDisabled}
        inputRef={textInputRef}
        draft={session.draft}
        onDraftChange={session.setDraft}
        micLang={session.micLang}
        onMicLangChange={session.setMicLang}
        onMicPressStart={() => void session.startTalk()}
        onMicPressEnd={session.stopTalk}
        onToggleAudio={session.toggleAudio}
        onSend={(text) => void session.sendText(text)}
        onSkip={session.skip}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <InfoPanel
        open={settingsOpen}
        title={t("settings.title")}
        onClose={() => setSettingsOpen(false)}
      >
        <AvatarGenderToggle gender={gender} onChange={setGender} />
        <p className="text-zinc-400">{t("settings.futureNote")}</p>
        {logoutControl}
      </InfoPanel>

      <InfoPanel
        open={helpOpen}
        title={t("help.title")}
        onClose={() => setHelpOpen(false)}
      >
        <p>{t("help.intro", { name: avatarName })}</p>
        <ul className="ml-4 list-disc space-y-1 text-zinc-200">
          <li>{t("help.li1")}</li>
          <li>{t("help.li2")}</li>
          <li>{t("help.li3")}</li>
        </ul>
        <p className="text-zinc-400">{t("help.outro")}</p>
      </InfoPanel>
    </main>
  );
}
