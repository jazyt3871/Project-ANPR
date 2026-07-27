import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { credentials } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Attempts per hour per IP. Generous for typos, useless for guessing. */
const LOGIN_LIMIT_PER_HOUR = 20;

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  const limit = await rateLimit(`login:${ip}`, LOGIN_LIMIT_PER_HOUR, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = credentials.safeParse(body);
  if (!parsed.success) {
    // Deliberately not field-specific: at the login form, "that username is too
    // short" and "wrong password" are both just "those credentials don't work",
    // and distinguishing them enumerates accounts.
    return NextResponse.json(
      { error: "That username and password don't match an account." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { username, password } = parsed.data;

  try {
    // Case-insensitive to match the unique index: whoever registered "Anpr"
    // must be able to sign in as "anpr".
    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });

    // Verify even when the user does not exist, against a dummy hash, so a
    // missing account and a wrong password take the same time. Otherwise the
    // response time alone enumerates who has an account here.
    const stored = user?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, stored);

    if (!user || !ok) {
      return NextResponse.json(
        { error: "That username and password don't match an account." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    await createSession(user.id);
    return NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[auth/login] failed", err);
    return NextResponse.json(
      { error: "Sign-in is unavailable right now. Try again shortly." },
      { status: 503 },
    );
  }
}

/**
 * A real scrypt hash of a value nobody can supply, so the no-such-user path
 * does the same work as the wrong-password path. Generated once at module load
 * rather than hardcoded, so it always matches the current hash format.
 */
const DUMMY_HASH =
  "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
