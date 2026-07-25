import { prisma } from "@/lib/db";

/**
 * Sliding-window limiter backed by the `rate_limit_hits` table.
 *
 * This deliberately does not live in process memory. On Vercel each request may
 * be served by a different lambda, so an in-process Map would let a submitter
 * multiply their quota by the number of warm instances — the limit would look
 * enforced in dev and be nearly meaningless in production.
 *
 * Two round-trips per call (count, then insert). That is cheap next to the
 * upload the limiter is guarding, and it keeps the window honest across
 * instances. Old hits are swept opportunistically rather than on a cron.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest hit ages out. 0 when not limited. */
  retryAfter: number;
};

/** Sweep expired rows on roughly 1 in N calls, so the table stays bounded. */
const SWEEP_PROBABILITY = 0.02;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = new Date(now - windowMs);

  try {
    const hits = await prisma.rateLimitHit.findMany({
      where: { key, at: { gte: since } },
      orderBy: { at: "asc" },
      select: { at: true },
    });

    if (hits.length >= limit) {
      const oldest = hits[0].at.getTime();
      return {
        ok: false,
        limit,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      };
    }

    await prisma.rateLimitHit.create({ data: { key } });

    if (Math.random() < SWEEP_PROBABILITY) {
      // Fire-and-forget: a failed sweep must never fail the request.
      prisma.rateLimitHit
        .deleteMany({ where: { at: { lt: since } } })
        .catch((err) => console.error("[rate-limit] sweep failed", err));
    }

    return {
      ok: true,
      limit,
      remaining: limit - hits.length - 1,
      retryAfter: 0,
    };
  } catch (err) {
    // Fail open. A limiter that 500s when the database hiccups turns a
    // degraded dependency into a full outage; the submission path has its own
    // size, MIME and magic-number checks behind this.
    console.error("[rate-limit] check failed, allowing request", err);
    return { ok: true, limit, remaining: limit, retryAfter: 0 };
  }
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}
