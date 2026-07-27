import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { canDelete, toDTO } from "@/lib/serialize";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  // The column is a Postgres uuid, so an unparseable id would reach the
  // database as a cast error and surface as a 500. It is a bad request.
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Malformed camera id." }, { status: 400 });
  }

  try {
    const viewer = await currentUser();
    const camera = await prisma.camera.findUnique({
      where: { id },
      include: { user: { select: { username: true } } },
    });
    if (!camera) {
      return NextResponse.json({ error: "No camera with that id." }, { status: 404 });
    }

    return NextResponse.json(
      { camera: toDTO(camera, viewer) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[cameras/:id] query failed", err);
    return NextResponse.json(
      { error: "That camera could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE /api/cameras/:id — the submitter, or any admin                      */
/* -------------------------------------------------------------------------- */

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Malformed camera id." }, { status: 400 });
  }

  const viewer = await currentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in to delete a camera." }, { status: 401 });
  }

  try {
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) {
      return NextResponse.json({ error: "No camera with that id." }, { status: 404 });
    }

    // The same predicate the DTO used to decide whether to show the button, so
    // what the UI offers and what the server permits cannot drift apart.
    if (!canDelete(camera, viewer)) {
      return NextResponse.json(
        { error: "You can only delete cameras you added." },
        { status: 403 },
      );
    }

    await prisma.camera.delete({ where: { id } });

    // Row first, photo second. If this fails the record is still gone, which is
    // what was asked for; an orphaned file is a tidiness problem, whereas a row
    // pointing at a deleted photo is a broken pin on the map.
    try {
      await storage().remove(camera.photoKey);
    } catch (err) {
      console.error("[cameras/:id] row deleted but photo remains", camera.photoKey, err);
    }

    return NextResponse.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cameras/:id] delete failed", err);
    return NextResponse.json(
      { error: "That camera could not be deleted. Try again shortly." },
      { status: 500 },
    );
  }
}
