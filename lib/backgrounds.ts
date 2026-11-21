/**
 * Scene backgrounds. All backgrounds (including the former built-in office set)
 * are now admin-managed: the admin uploads/deletes them and picks which one the
 * client shows (issue 6 rework 2026-06-25). The client just fetches the list +
 * the admin-selected `active_background` and renders that single image - no more
 * `b`-key cycling.
 *
 * `DEFAULT_BACKGROUND` is a last-resort static fallback (ships in public/bg/) so
 * the scene is never empty if the storage/list call fails entirely.
 */
export const DEFAULT_BACKGROUND = "/bg/office_lobby.jpg";
export const BACKGROUND_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const MAX_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024;

export function backgroundImageMediaType(filename: string): string | null {
  const extension = /\.(png|jpe?g|webp)$/i.exec(filename)?.[1].toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png" || extension === "webp") return `image/${extension}`;
  return null;
}

export type RemoteBackground = { id: string; name: string; url: string };

/**
 * Fetch admin-registered backgrounds (proxied through our own API so it works in
 * dev and behind Caddy alike). Returns [] on any error.
 */
export async function fetchBackgrounds(): Promise<RemoteBackground[]> {
  try {
    const res = await fetch("/api/backgrounds", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { backgrounds?: RemoteBackground[] };
    return (json.backgrounds ?? []).filter((b) => b && b.id && b.url);
  } catch {
    return [];
  }
}
