import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { formatKbFileSize, kbPreviewKind, KB_STORAGE_QUOTA_BYTES } from "@/lib/kb-file";
import { readDemoStore, writeDemoStore, type DemoFile } from "@/lib/server/demo-store";
import { KB_UPLOAD_DIRECTORY } from "@/lib/server/kb-uploads";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const files = form?.getAll("file").filter((part): part is File => typeof part !== "string") ?? [];
  const targetFolder = form?.get("folder");
  const folder = typeof targetFolder === "string" && targetFolder.trim() ? targetFolder.trim() : "root";
  if (!files.length) return Response.json({ error: "Select at least one file" }, { status: 400 });
  if (files.some((file) => !kbPreviewKind(file.name, file.type))) {
    return Response.json({ error: "Unsupported file format" }, { status: 415 });
  }

  const incomingBytes = files.reduce((total, file) => total + file.size, 0);
  const usedBytes = (items: DemoFile[]) => items.reduce((sum, item) => sum + (item.deleted ? 0 : item.sizeBytes), 0);
  if (usedBytes(readDemoStore().files) + incomingBytes > KB_STORAGE_QUOTA_BYTES) {
    return Response.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  const written: string[] = [];
  const uploads: Omit<DemoFile, "id">[] = [];
  try {
    await mkdir(KB_UPLOAD_DIRECTORY, { recursive: true });
    for (const file of files) {
      const uploadKey = randomUUID();
      const target = path.join(KB_UPLOAD_DIRECTORY, uploadKey);
      written.push(target);
      await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target, { flags: "wx" }));
      uploads.push({
        filename: file.name.replace(/^.*[\\/]/, ""),
        size: formatKbFileSize(file.size),
        sizeBytes: file.size,
        status: "done",
        updated: new Date().toISOString().replace("T", " ").slice(0, 16),
        folder,
        uploadKey,
        mediaType: file.type,
        rawContent: kbPreviewKind(file.name, file.type) === "text" ? await file.slice(0, 32_768).text() : undefined,
      });
    }

    const current = readDemoStore().files;
    if (usedBytes(current) + incomingBytes > KB_STORAGE_QUOTA_BYTES) {
      await Promise.allSettled(written.map((file) => unlink(file)));
      return Response.json({ error: "Storage quota exceeded" }, { status: 413 });
    }
    const firstId = current.reduce((max, file) => Math.max(max, file.id), Date.now()) + 1;
    const added = uploads.map((file, index) => ({ ...file, id: firstId + index }));
    writeDemoStore({ files: [...added, ...current] }, { throwOnError: true });
    return Response.json({ files: added }, { status: 201 });
  } catch (error) {
    await Promise.allSettled(written.map((file) => unlink(file)));
    console.error("[KB files] Could not save originals:", error);
    return Response.json({ error: "Failed to upload files" }, { status: 500 });
  }
}
