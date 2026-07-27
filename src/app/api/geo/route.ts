import { NextResponse, type NextRequest } from "next/server";
import { boundsForCountry } from "@/lib/country-bounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where should the map open? Returns a bounding box for the visitor's country,
 * or the whole world when that can't be determined.
 *
 * The country comes from headers the proxy in front of this app already
 * attaches — Cloudflare, Fly and Vercel all resolve it at the edge. No request
 * is made to a third-party geolocation service: that would send every
 * visitor's IP address to someone else, and add a network dependency to the
 * first paint, to place a map that the user is about to pan anyway.
 *
 * The consequence is that a bare-IP deployment with no proxy gets the world
 * view, which is the correct fallback rather than a failure.
 */
const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare (including Cloudflare Tunnel)
  "x-vercel-ip-country", // Vercel
  "fly-client-country", // Fly.io
  "x-country-code", // common convention for hand-rolled proxies
] as const;

export function GET(request: NextRequest) {
  let code: string | null = null;

  for (const header of COUNTRY_HEADERS) {
    const value = request.headers.get(header);
    // Cloudflare sends XX for anonymised clients and T1 for Tor exit nodes;
    // neither is a place, so both fall through to the world view.
    if (value && /^[A-Za-z]{2}$/.test(value) && !["XX", "T1"].includes(value.toUpperCase())) {
      code = value;
      break;
    }
  }

  const { bounds, country } = boundsForCountry(code);

  return NextResponse.json(
    { bounds, country },
    {
      headers: {
        "Cache-Control": "no-store",
        // Same URL, different answer per visitor — say so, in case a CDN is
        // ever put in front of this.
        Vary: COUNTRY_HEADERS.join(", "),
      },
    },
  );
}
