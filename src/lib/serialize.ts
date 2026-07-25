import type { Camera } from "@prisma/client";
import { photoUrl } from "@/lib/storage";
import type { CameraDTO, HeadingSource } from "@/lib/types";

/**
 * Single place a database row becomes API output. submitterHash is deliberately
 * absent — it exists for rate limiting, not for publishing.
 */
export function toDTO(row: Camera): CameraDTO {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    heading: row.heading,
    headingSource: row.headingSource as HeadingSource,
    photoUrl: photoUrl(row.photoKey),
    photoWidth: row.photoWidth,
    photoHeight: row.photoHeight,
    note: row.note,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
