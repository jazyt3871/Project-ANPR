import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDTO } from "@/lib/serialize";

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
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) {
      return NextResponse.json({ error: "No camera with that id." }, { status: 404 });
    }

    return NextResponse.json(
      { camera: toDTO(camera) },
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
