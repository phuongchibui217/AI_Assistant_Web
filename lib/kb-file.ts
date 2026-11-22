export const KB_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

export type KbPreviewKind = "docx" | "xlsx" | "pdf" | "image" | "html" | "text";

const imageTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
};

export function kbImageMediaType(filename: string, mediaType = ""): string | undefined {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (Object.hasOwn(imageTypes, extension)) return imageTypes[extension];
  return /^image\/[a-z0-9.+-]+$/i.test(mediaType) ? mediaType : undefined;
}

export function kbPreviewKind(filename: string, mediaType?: string): KbPreviewKind | null {
  if (/\.docx$/i.test(filename)) return "docx";
  if (/\.xlsx$/i.test(filename)) return "xlsx";
  if (/\.pdf$/i.test(filename)) return "pdf";
  if (/\.html?$/i.test(filename)) return "html";
  if (/\.(txt|md|csv)$/i.test(filename)) return "text";
  return kbImageMediaType(filename, mediaType) ? "image" : null;
}

export function formatKbFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
