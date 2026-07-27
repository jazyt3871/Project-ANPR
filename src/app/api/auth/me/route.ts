import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I? `{ user: null }` for guests — not a 401, since guests are expected. */
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
