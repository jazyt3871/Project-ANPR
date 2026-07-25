"use client";

import { useRef, useState } from "react";
import { Camera, ImageUp, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Notice } from "@/components/ui/primitives";
import { formatBytes, preparePhoto, type PreparedPhoto } from "@/lib/image";

export type StepPhotoProps = {
  previewUrl: string | null;
  onPhoto: (photo: PreparedPhoto) => void;
  onClear: () => void;
};

export function StepPhoto({ previewUrl, onPhoto, onClear }: StepPhotoProps) {
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const libraryInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ from: number; to: number } | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      setStats({ from: prepared.originalBytes, to: prepared.blob.size });
      onPhoto(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be processed.");
    } finally {
      setBusy(false);
      // Reset so picking the same file twice still fires a change event.
      if (cameraInput.current) cameraInput.current.value = "";
      if (libraryInput.current) libraryInput.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-graphite">
        Photograph the camera itself, close enough that the housing is recognisable.
      </p>

      {/* capture="environment" opens the rear camera straight away on mobile.
          The second input is the fallback for desktop and for photos taken earlier. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {previewUrl ? (
        <figure className="overflow-hidden rounded-xl border border-rule bg-raised">
          {/* Object URL of a client-side blob: next/image would gain nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="The photo you just took"
            className="max-h-[46dvh] w-full object-contain"
          />
          {stats ? (
            <figcaption className="readout border-t border-rule px-3 py-2 text-[0.6875rem] text-graphite">
              {formatBytes(stats.from)} → {formatBytes(stats.to)} · resized and stripped of
              metadata
            </figcaption>
          ) : null}
        </figure>
      ) : (
        <button
          type="button"
          onClick={() => cameraInput.current?.click()}
          disabled={busy}
          className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-rule bg-raised text-graphite transition-colors hover:border-sodium/60 hover:text-ink disabled:opacity-50"
        >
          <span className="flex flex-col items-center gap-2.5">
            <Camera className="size-7" strokeWidth={1.5} />
            <span className="text-sm font-medium">
              {busy ? "Processing…" : "Open the camera"}
            </span>
          </span>
        </button>
      )}

      {error ? (
        <Notice tone="bad" icon={<TriangleAlert className="size-4" />} title="That photo did not load">
          {error}
        </Notice>
      ) : null}

      <Notice tone="info" icon={<ShieldCheck className="size-4" />} title="Metadata is removed before upload">
        The photo is re-encoded in your browser, which drops every EXIF tag — including the
        camera&rsquo;s own GPS record. The only position stored is the one you confirmed.
      </Notice>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Button variant="ghost" onClick={() => cameraInput.current?.click()} disabled={busy}>
          <RefreshCw className="size-4" />
          {previewUrl ? "Retake" : "Open the camera"}
        </Button>
        <Button variant="ghost" onClick={() => libraryInput.current?.click()} disabled={busy}>
          <ImageUp className="size-4" />
          Choose a file
        </Button>
      </div>

      {previewUrl ? (
        <Button variant="quiet" onClick={onClear} className="w-full">
          Remove this photo
        </Button>
      ) : null}
    </div>
  );
}
