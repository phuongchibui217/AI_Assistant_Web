// Single client-side writer for the UI-locale cookie. The value is read back
// server-side in `i18n/request.ts` to pick the message bundle.
//
// SameSite=None; Secure; Partitioned (instead of the old Lax) so the cookie
// survives when the app runs inside a cross-origin <iframe> embed (embed.js):
// a Lax cookie is treated as third-party there and silently dropped, which
// broke the language switch on customer sites. None+Secure is fine standalone
// too - Secure is honoured on prod HTTPS and on loopback (http://localhost,
// *.localhost, 127.0.0.1) which browsers treat as potentially trustworthy.
// Partitioned (CHIPS) keeps the cookie isolated per embedding top-level site.
// Caveat: a raw LAN-IP dev host over plain HTTP would drop the Secure cookie;
// use loopback or HTTPS for dev.
export const LOCALE_COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function setLocaleCookie(code: string): void {
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${ONE_YEAR}; SameSite=None; Secure; Partitioned`;
}
