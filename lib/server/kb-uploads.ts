import path from "node:path";

export const KB_UPLOAD_DIRECTORY = path.join(process.cwd(), "kb-uploads");

export function kbUploadPath(key: string): string | null {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key)
    ? path.join(KB_UPLOAD_DIRECTORY, key)
    : null;
}
