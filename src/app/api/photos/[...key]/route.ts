import { NextResponse } from "next/server";
import { isValidKey, storage } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ key: string[] }> };

/**
 * Serves stored photos. Uploads live outside /public on purpose: every read
 * passes through this handler, so the key is validated before it ever reaches
 * the filesystem, and moderation or auth can be added in one place later.
 */
export async function GET(_request: Request, { params }: Params) {
  const { key: segments } = await params;
  const key = segments.join("/");

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Malformed photo key." }, { status: 400 });
  }

  try {
    const { body, contentType } = await storage().get(key);
    // Uint8Array is not a BodyInit; Blob is, and it carries the type with it.
    return new NextResponse(new Blob([body], { type: contentType }), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        // Keys are immutable, so this can be cached hard.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
}
