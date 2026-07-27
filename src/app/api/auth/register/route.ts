import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { credentials, fieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accounts per hour per IP. Enough for a household, not enough to bulk-create. */
const REGISTER_LIMIT_PER_HOUR = 5;

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  const limit = await rateLimit(`register:${ip}`, REGISTER_LIMIT_PER_HOUR, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many accounts created from here. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = credentials.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the username and password.", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;

  try {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), role: "user" },
    });

    await createSession(user.id);
    return NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { status: 201 },
    );
  } catch (err) {
    // P2002 is the unique index on lower(username). Checking first and then
    // inserting would race; letting the database decide is the only account of
    // uniqueness that is actually true.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "That username is taken.", fields: { username: "That username is taken." } },
        { status: 409 },
      );
    }
    console.error("[auth/register] failed", err);
    return NextResponse.json(
      { error: "The account could not be created. Try again shortly." },
      { status: 500 },
    );
  }
}
