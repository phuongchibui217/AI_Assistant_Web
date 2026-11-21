import { backgroundImageMediaType, MAX_BACKGROUND_IMAGE_BYTES } from "@/lib/backgrounds";
import { readDemoStore, writeDemoStore, type DemoBackground } from "@/lib/server/demo-store";
import { hasLoginSession } from "@/lib/server/login-sessions";

export const runtime = "nodejs";

function matchesImageFormat(bytes: Buffer, type: string): boolean {
  switch (type) {
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/jpeg":
      return bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    case "image/webp":
      return bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
    default:
      return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!file || typeof file === "string") {
    return Response.json({ error: "Missing image" }, { status: 400 });
  }

  const filename = file.name.replace(/^.*[\\/]/, "");
  const mediaType = backgroundImageMediaType(filename);
  if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
    return Response.json({ error: "Image too large" }, { status: 413 });
  }
  if (!mediaType) {
    return Response.json({ error: "Unsupported image format" }, { status: 415 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesImageFormat(bytes, mediaType)) {
      return Response.json({ error: "Unsupported image format" }, { status: 415 });
    }

    const { backgrounds } = readDemoStore();
    const background: DemoBackground = {
      id: Math.max(Date.now(), ...backgrounds.map((item) => item.id + 1)),
      name: filename.replace(/\.[^/.]+$/, ""),
      filename,
      url: `data:${mediaType};base64,${bytes.toString("base64")}`,
      active: false,
    };
    writeDemoStore({ backgrounds: [...backgrounds, background] }, { throwOnError: true });
    return Response.json(background, { status: 201 });
  } catch (err) {
    console.error("[API admin/backgrounds] upload failed:", err);
    return Response.json({ error: "Failed to upload image" }, { status: 500 });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  if (!hasLoginSession("admin")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (typeof body?.id !== "number" || (body.action !== "activate" && body.action !== "delete")) {
    return Response.json({ error: "Invalid background update" }, { status: 400 });
  }

  const { backgrounds } = readDemoStore();
  if (!backgrounds.some((item) => item.id === body.id)) {
    return Response.json({ error: "Background not found" }, { status: 404 });
  }
  const updated = body.action === "activate"
    ? backgrounds.map((item) => ({ ...item, active: item.id === body.id }))
    : backgrounds.filter((item) => item.id !== body.id);
  try {
    writeDemoStore({ backgrounds: updated }, { throwOnError: true });
    return Response.json({ backgrounds: updated });
  } catch (err) {
    console.error("[API admin/backgrounds] update failed:", err);
    return Response.json({ error: "Failed to update background" }, { status: 500 });
  }
}
