/** Geometry helpers. Pure functions — safe on both client and server. */

export const CARDINALS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/** Wrap any angle into [0, 360). */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 117 -> "ESE" */
export function cardinal(deg: number): string {
  const i = Math.round(normalizeBearing(deg) / 22.5) % 16;
  return CARDINALS[i];
}

/** "117° ESE" */
export function formatBearing(deg: number): string {
  return `${Math.round(normalizeBearing(deg))}° ${cardinal(deg)}`;
}

/** Signed smallest rotation from a to b, in (-180, 180]. */
export function bearingDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * Circular mean of a set of bearings. A plain average is wrong across the
 * 0/360 seam (359 and 1 average to 180), so sum unit vectors instead.
 */
export function circularMean(degrees: number[]): number | null {
  if (degrees.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const d of degrees) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Parse a "west,south,east,north" query parameter. Returns null if unusable. */
export function parseBBox(raw: string | null | undefined): BBox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (south < -90 || north > 90 || south > north) return null;
  if (west < -180 || east > 180) return null;
  return { west, south, east, north };
}

/** True when the box wraps the antimeridian (west edge numerically east of the east edge). */
export function crossesAntimeridian(box: BBox): boolean {
  return box.west > box.east;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point reached by travelling `metres` along `bearing` from an origin. */
export function destination(
  origin: { lat: number; lng: number },
  bearing: number,
  metres: number,
): { lat: number; lng: number } {
  const toRad = Math.PI / 180;
  const d = metres / EARTH_RADIUS_M;
  const br = bearing * toRad;
  const lat1 = origin.lat * toRad;
  const lng1 = origin.lng * toRad;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: lat2 / toRad,
    lng: (((lng2 / toRad) + 540) % 360) - 180,
  };
}

/** "±6 m" / "±1.2 km" */
export function formatAccuracy(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "unknown";
  if (metres < 1000) return `±${metres < 10 ? metres.toFixed(1) : Math.round(metres)} m`;
  return `±${(metres / 1000).toFixed(1)} km`;
}

/** 43.6532 -> "43.65320" — enough precision for a street-level fix. */
export function formatCoord(value: number): string {
  return value.toFixed(5);
}

export type FixQuality = "excellent" | "good" | "poor" | "unusable";

/** Accuracy bands used to colour the fix meter and to gate the Continue button. */
export function fixQuality(accuracy: number | null | undefined): FixQuality {
  if (accuracy == null || !Number.isFinite(accuracy)) return "unusable";
  if (accuracy <= 10) return "excellent";
  if (accuracy <= 25) return "good";
  if (accuracy <= 75) return "poor";
  return "unusable";
}
