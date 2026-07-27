import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { crossesAntimeridian, parseBBox } from "@/lib/geo";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { storage, submitterHash } from "@/lib/storage";
import {
  ALLOWED_IMAGE_TYPES,
  bboxQuery,
  cameraSubmission,
  fieldErrors,
} from "@/lib/validation";
import { toDTO } from "@/lib/serialize";

export const runtime = "nodejs"; // the local storage driver touches fs
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR ?? 20);

/* -------------------------------------------------------------------------- */
/* GET /api/cameras?bbox=west,south,east,north&limit=500                      */
/* -------------------------------------------------------------------------- */

export async function GET(request: NextRequest) {
  const parsed = bboxQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { bbox: rawBBox, limit } = parsed.data;
  const box = parseBBox(rawBBox);

  let where: Prisma.CameraWhereInput = {};
  if (box) {
    const latRange = { gte: box.south, lte: box.north };
    where = crossesAntimeridian(box)
      ? {
          lat: latRange,
          OR: [{ lng: { gte: box.west } }, { lng: { lte: box.east } }],
        }
      : { lat: latRange, lng: { gte: box.west, lte: box.east } };
  }

  try {
    // The viewer decides only which delete buttons the client renders; the
    // DELETE handler re-checks independently, so a forged canDelete is inert.
    const viewer = await currentUser();
    const cameras = await prisma.camera.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { username: true } } },
    });

    return NextResponse.json(
      {
        cameras: cameras.map((row) => toDTO(row, viewer)),
        count: cameras.length,
        truncated: cameras.length === limit,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // Misconfigured DATABASE_URL is the overwhelmingly common cause on a first
    // deploy. Log the detail, return a message the map can show, and keep the
    // connection string out of the response.
    console.error("[cameras] query failed", err);
    return NextResponse.json(
      { error: "The camera list is unavailable right now. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/cameras — multipart/form-data                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: NextRequest) {
  // Reading the map is open; adding to it is not. Checked before anything is
  // parsed or written, so an anonymous request costs nothing but this lookup.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to add a camera." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ip = clientIp(request.headers);
  const limitResult = await rateLimit(`submit:${ip}`, RATE_LIMIT_PER_HOUR, 60 * 60_000);
  if (!limitResult.ok) {
    return NextResponse.json(
      {
        error: `Submission limit reached (${limitResult.limit} per hour). Try again in ${Math.ceil(
          limitResult.retryAfter / 60,
        )} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limitResult.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart/form-data body." },
      { status: 400 },
    );
  }

  // --- metadata ------------------------------------------------------------
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string"),
  );
  const parsed = cameraSubmission.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some fields are missing or out of range.", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  // --- photo ---------------------------------------------------------------
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "A photo is required." }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(photo.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return NextResponse.json(
      { error: "Photos must be JPEG, PNG, or WebP." },
      { status: 415 },
    );
  }
  if (photo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That photo is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (!looksLikeImage(bytes, photo.type)) {
    return NextResponse.json(
      { error: "That file's contents don't match an image of the declared type." },
      { status: 415 },
    );
  }

  // --- persist -------------------------------------------------------------
  let key: string;
  try {
    ({ key } = await storage().put(bytes, photo.type));
  } catch (err) {
    console.error("[cameras] storage write failed", err);
    return NextResponse.json(
      { error: "The photo could not be stored. Try again shortly." },
      { status: 502 },
    );
  }

  const data = parsed.data;

  try {
    const camera = await prisma.camera.create({
      data: {
        lat: data.lat,
        lng: data.lng,
        accuracy: data.accuracy ?? null,
        // 360 and 0 are the same bearing; store one of them.
        heading: data.heading % 360,
        headingSource: data.headingSource,
        photoKey: key,
        photoWidth: data.photoWidth ?? null,
        photoHeight: data.photoHeight ?? null,
        note: data.note ?? null,
        capturedAt: data.capturedAt ?? new Date(),
        submitterHash: submitterHash(ip, request.headers.get("user-agent") ?? ""),
        userId: user.id,
      },
      // Without this the returned row has no `user`, and the DTO the client
      // renders straight into the detail sheet would say "anonymous" until the
      // next refetch.
      include: { user: { select: { username: true } } },
    });

    return NextResponse.json({ camera: toDTO(camera, user) }, { status: 201 });
  } catch (err) {
    console.error("[cameras] insert failed", err);
    return NextResponse.json(
      { error: "The submission could not be saved. Try again shortly." },
      { status: 500 },
    );
  }
}

/** Magic-number check so a renamed .exe can't be stored as image/jpeg. */
function looksLikeImage(bytes: Uint8Array, declaredType: string): boolean {
  if (bytes.length < 12) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (declaredType === "image/jpeg") return jpeg;
  if (declaredType === "image/png") return png;
  if (declaredType === "image/webp") return webp;
  return false;
}
