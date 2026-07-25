import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Photo storage behind a two-method interface so the deployment target can
 * change without touching the route handlers.
 *
 *   STORAGE_DRIVER=supabase  -> a Supabase Storage bucket (production)
 *   STORAGE_DRIVER=local     -> UPLOAD_DIR on the server's disk (dev only)
 *
 * When STORAGE_DRIVER is unset the driver is inferred from whether SUPABASE_URL
 * is present. Serverless platforms with read-only filesystems (Vercel, Netlify
 * functions) cannot use the local driver at all.
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
/* Supabase Storage                                                           */
/* -------------------------------------------------------------------------- */

class SupabaseDriver implements StorageDriver {
  readonly name = "supabase";
  private readonly url: string;
  private readonly serviceKey: string;
  private readonly bucket: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | null = null;

  constructor(url: string, serviceKey: string, bucket: string) {
    this.url = url;
    this.serviceKey = serviceKey;
    this.bucket = bucket;
  }

  private async getClient() {
    if (this.client) return this.client;
    // Imported lazily so `local` deployments never need the package installed.
    const mod = await import("@supabase/supabase-js").catch(() => {
      throw new Error(
        "STORAGE_DRIVER=supabase requires `npm install @supabase/supabase-js`",
      );
    });
    this.client = mod.createClient(this.url, this.serviceKey, {
      auth: { persistSession: false },
    });
    return this.client;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<PutResult> {
    const key = buildKey(contentType);
    const client = await this.getClient();
    const { error } = await client.storage
      .from(this.bucket)
      .upload(key, bytes, { contentType, upsert: false });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return { key };
  }

  async get(key: string): Promise<GetResult> {
    if (!isValidKey(key)) throw new Error("Invalid storage key");
    const client = await this.getClient();
    const { data, error } = await client.storage.from(this.bucket).download(key);
    if (error || !data) {
      throw new Error(`Supabase download failed: ${error?.message ?? "no body"}`);
    }
    return { body: await data.arrayBuffer(), contentType: contentTypeForKey(key) };
  }

  publicUrl(key: string): string | null {
    // supabase/schema.sql creates the bucket public, so serve straight from the
    // CDN by default. Set SUPABASE_BUCKET_PUBLIC=false if you later make the
    // bucket private: reads then fall back to /api/photos, which streams the
    // bytes through the service-role key instead.
    if (process.env.SUPABASE_BUCKET_PUBLIC === "false") return null;
    return `${this.url}/storage/v1/object/public/${this.bucket}/${key}`;
  }
}

/* -------------------------------------------------------------------------- */

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;

  // Infer rather than default to "local": a Vercel deployment has a read-only
  // filesystem, so silently falling back to the local driver there would fail
  // at the first upload rather than at boot. If Supabase is configured, use it.
  const driver = (
    process.env.STORAGE_DRIVER ??
    (process.env.SUPABASE_URL ? "supabase" : "local")
  ).toLowerCase();

  if (driver === "local" && process.env.VERCEL) {
    throw new Error(
      "STORAGE_DRIVER=local cannot work on Vercel: the filesystem is read-only. " +
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the project's " +
        "environment variables.",
    );
  }

  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET ?? "camera-photos";
    if (!url || !key) {
      throw new Error(
        "STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    cached = new SupabaseDriver(url, key, bucket);
    return cached;
  }

  cached = new LocalDriver(process.env.UPLOAD_DIR ?? "./storage/uploads");
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
  const salt = process.env.SUBMITTER_SALT ?? "sightline";
  return createHash("sha256")
    .update(`${salt}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 16);
}
