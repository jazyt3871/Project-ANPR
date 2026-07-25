/**
 * Client-side photo preparation. Runs in the browser only.
 *
 * Two things happen here, both deliberate:
 *   1. Downscale to MAX_DIMENSION so a 12 MP phone photo becomes a ~300 KB
 *      upload instead of a 5 MB one.
 *   2. Re-encode through a canvas, which drops every EXIF tag — including the
 *      camera's own GPS record. The only position this app ever stores is the
 *      one the submitter explicitly confirmed.
 */

export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.82;

export type PreparedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
  originalBytes: number;
};

async function decode(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the EXIF orientation flag before we rasterize, so
      // portrait photos don't come out sideways.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // fall through to the <img> path
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file could not be read as an image."));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function preparePhoto(
  file: File,
  maxDimension = MAX_DIMENSION,
): Promise<PreparedPhoto> {
  const { source, width, height, release } = await decode(file);

  try {
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not open a canvas to resize the photo.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, outW, outH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("The photo could not be re-encoded.")),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });

    return {
      blob,
      width: outW,
      height: outH,
      previewUrl: URL.createObjectURL(blob),
      originalBytes: file.size,
    };
  } finally {
    release();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
