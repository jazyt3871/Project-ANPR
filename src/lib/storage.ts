import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Photo storage behind a two-method interface, so swapping the backing store
 * later is one class rather than a change to every route handler.
 *
 * There is one driver: UPLOAD_DIR on the server's own disk. That is the whole
 * deployment model — Postgres and the photos live on the same box as the app.
 * A host with a read-only or ephemeral filesystem needs a second driver
 * implementing this interface; nothing outside this file would change.
 */

export type PutResult = { key: string };
export type GetResult = { body: ArrayBuffer; contentType: string };

export interface StorageDriver {
  readonly name: string;
  put(bytes: Uint8Array, contentType: string): Promise<PutResult>;
  get(key: string): Promise<GetResult>;
  /** Public URL, or null when bytes must be streamed through /api/photos. */
  publicUrl(key: string): string | null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Keys are always `YYYY/MM/<uuid>.<ext>`. Validating against this shape is what
 * keeps `/api/photos/<key>` from being turned into a path-traversal read.
 */
export const KEY_PATTERN = /^\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Copy a view into a standalone ArrayBuffer.
 *
 * TypeScript 5.7 made TypedArray generic over its backing buffer, so a Node
 * Buffer is a `Uint8Array<ArrayBufferLike>` and no longer satisfies `BodyInit`.
 * Returning a plain ArrayBuffer keeps the driver interface assignable to a
 * Response body without a cast, and detaches the bytes from Node's shared
 * read pool while we're at it.
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

function buildKey(contentType: string): string {
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/* -------------------------------------------------------------------------- */
/* Local disk                                                                 */
/* -------------------------------------------------------------------------- */

class LocalDriver implements StorageDriver {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!isValidKey(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    // Belt and braces: the key pattern already forbids "..", but never trust it.
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error("Resolved path escapes the upload directory");
    }
    return full;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<PutResult> {
    const key = buildKey(contentType);
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return { key };
  }

  async get(key: string): Promise<GetResult> {
    const file = await fs.readFile(this.resolve(key));
    return { body: toArrayBuffer(file), contentType: contentTypeForKey(key) };
  }

  publicUrl(): string | null {
    return null; // streamed through the photos route handler
  }
}

/* -------------------------------------------------------------------------- */

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  cached ??= new LocalDriver(process.env.UPLOAD_DIR ?? "./storage/uploads");
  return cached;
}

/** URL the browser should load for a stored photo. */
export function photoUrl(key: string): string {
  return storage().publicUrl(key) ?? `/api/photos/${key}`;
}

/**
 * Coarse, non-reversible submitter tag. Truncated so it groups repeat
 * submitters for rate limiting without being a durable identifier.
 */
export function submitterHash(ip: string, userAgent: string): string {
  const salt = process.env.SUBMITTER_SALT ?? "project-anpr";
  return createHash("sha256")
    .update(`${salt}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 16);
}
