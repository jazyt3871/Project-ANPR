import { z } from "zod";

/**
 * Metadata that accompanies the photo in the multipart body. Everything
 * arrives as a string from FormData, so coerce and then bound hard.
 */
export const cameraSubmission = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  accuracy: z.coerce.number().finite().min(0).max(100_000).optional(),
  heading: z.coerce.number().finite().min(0).max(360),
  headingSource: z.enum(["sensor", "manual"]).default("sensor"),
  note: z
    .string()
    .trim()
    .max(280)
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional(),
  photoWidth: z.coerce.number().int().positive().max(20_000).optional(),
  photoHeight: z.coerce.number().int().positive().max(20_000).optional(),
  capturedAt: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, {
      message: "capturedAt cannot be in the future",
    })
    .optional(),
});

export type CameraSubmission = z.infer<typeof cameraSubmission>;

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const bboxQuery = z.object({
  bbox: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

/**
 * Credentials. The username pattern is mirrored by a check constraint in
 * db/schema.sql, so a bad value cannot reach the table by another route.
 *
 * The 12-character password floor is deliberate and the only rule: length
 * dominates composition requirements for real-world strength, and character-
 * class rules mostly produce "Password1!". Nothing is capped below scrypt's
 * input limits.
 */
export const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Usernames are at least 3 characters.")
    .max(32, "Usernames are at most 32 characters.")
    .regex(
      /^[A-Za-z0-9_.-]+$/,
      "Usernames use letters, numbers, and . _ - only.",
    ),
  password: z
    .string()
    .min(12, "Passwords are at least 12 characters.")
    .max(256, "Passwords are at most 256 characters."),
});

/** Flatten a ZodError into a { field: message } map for the client. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
