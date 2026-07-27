import type { Camera } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import { photoUrl } from "@/lib/storage";
import type { CameraDTO, HeadingSource } from "@/lib/types";

/** A camera row with its owner's username joined in, when the query asked for it. */
export type CameraRow = Camera & { user?: { username: string } | null };

/**
 * Whether `viewer` is allowed to delete `row`: admins may delete anything,
 * everyone else only what they submitted. This is the single definition —
 * the DELETE handler calls it too, so the button the UI shows and the rule the
 * server enforces cannot drift apart.
 */
export function canDelete(row: Pick<Camera, "userId">, viewer: SessionUser | null): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return row.userId !== null && row.userId === viewer.id;
}

/**
 * Single place a database row becomes API output. submitterHash is deliberately
 * absent — it exists for rate limiting, not for publishing. userId is absent
 * too: who owns a row is exposed as a username and a permission, not an id.
 */
export function toDTO(row: CameraRow, viewer: SessionUser | null = null): CameraDTO {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    heading: row.heading,
    headingSource: row.headingSource as HeadingSource,
    is360: row.is360,
    photoUrl: photoUrl(row.photoKey),
    photoWidth: row.photoWidth,
    photoHeight: row.photoHeight,
    note: row.note,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    submittedBy: row.user?.username ?? null,
    canDelete: canDelete(row, viewer),
  };
}
