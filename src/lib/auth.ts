import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * Accounts and sessions, with no authentication dependency.
 *
 * Passwords use scrypt from node:crypto rather than bcrypt or argon2. Both of
 * those are native modules that have to be compiled or prebuilt per platform —
 * this project installs on a VPS, a Windows PC and inside a slim container, and
 * scrypt is memory-hard, in the standard library, and identical on all three.
 *
 * Sessions are database rows, not self-contained signed tokens. A signed token
 * cannot be revoked before it expires; a row can be deleted, so logging out and
 * deleting an account both take effect immediately. Only the SHA-256 of the
 * token is stored, so a database dump does not hand over live sessions.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** `scrypt$<salt-hex>$<hash-hex>`, so the format is self-describing on sight. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  // Length is already equal by construction, but timingSafeEqual throws rather
  // than returning false when it isn't, and a corrupt row must not 500.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export const SESSION_COOKIE = "anpr_session";
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = {
  id: string;
  username: string;
  role: "user" | "admin";
};

/**
 * Issue a session and set its cookie. The raw token is returned to the browser
 * once, in an httpOnly cookie; the server only ever keeps its hash.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure would make the cookie undeliverable over plain HTTP, which is how
    // this runs on a bare IP before a domain and certificate exist.
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in user, or null. Safe to call from any route or server component. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      // Expired rows are swept here rather than on a schedule: whoever presents
      // one is exactly who reveals it needs collecting.
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    return {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role === "admin" ? "admin" : "user",
    };
  } catch (err) {
    // A database hiccup means "not signed in", never a 500 on a page that is
    // perfectly viewable as a guest.
    console.error("[auth] session lookup failed", err);
    return null;
  }
}

/** Delete the current session and clear the cookie. Idempotent. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch((err) => console.error("[auth] session delete failed", err));
  }
  jar.delete(SESSION_COOKIE);
}
