"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Trash2, TriangleAlert } from "lucide-react";
import { SightlineGlyph } from "@/components/SightlineGlyph";
import { Button, FieldRow, Notice, Sheet } from "@/components/ui/primitives";
import { formatAccuracy, formatBearing, formatCoord, fixQuality } from "@/lib/geo";
import type { CameraDTO } from "@/lib/types";

export function CameraDetailSheet({
  camera,
  onClose,
  onDeleted,
}: {
  camera: CameraDTO | null;
  onClose: () => void;
  /** Called after the server confirms the row is gone, so the map can drop the pin. */
  onDeleted?: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Selecting a different camera must not inherit the previous one's armed
  // confirm — that is how someone deletes the wrong thing.
  const cameraId = camera?.id ?? null;
  useEffect(() => {
    setConfirming(false);
    setDeleteError(null);
  }, [cameraId]);

  if (!camera) return null;

  const coords = `${camera.lat.toFixed(6)}, ${camera.lng.toFixed(6)}`;
  const quality = fixQuality(camera.accuracy);

  async function copyCoords() {
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function remove() {
    if (!camera) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/cameras/${camera.id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setDeleteError(payload?.error ?? `The server refused (${res.status}).`);
        setConfirming(false);
        return;
      }
      onDeleted?.(camera.id);
      onClose();
    } catch {
      setDeleteError("The request never reached the server. Check your connection.");
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      eyebrow="Submitted camera"
      title={`Looking ${formatBearing(camera.heading)}`}
    >
      <div className="space-y-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={camera.photoUrl}
          alt={`Camera looking ${Math.round(camera.heading)} degrees`}
          width={camera.photoWidth ?? undefined}
          height={camera.photoHeight ?? undefined}
          loading="lazy"
          className="max-h-[42dvh] w-full rounded-xl border border-rule bg-raised object-contain"
        />

        <div className="flex items-center gap-4 rounded-xl border border-rule bg-raised p-4">
          <SightlineGlyph bearing={camera.heading} size={80} />
          <div className="min-w-0">
            <p className="eyebrow mb-1">Bearing from true north</p>
            <p className="readout text-2xl leading-none font-medium text-ink">
              {formatBearing(camera.heading)}
            </p>
            <p className="mt-1.5 text-[0.75rem] text-graphite">
              {camera.headingSource === "manual"
                ? "Set by hand on the dial"
                : "Read from the device compass"}
            </p>
          </div>
        </div>

        {camera.note ? (
          <blockquote className="border-l-2 border-sodium/50 pl-3.5 text-sm leading-relaxed text-ink">
            {camera.note}
          </blockquote>
        ) : null}

        <div>
          <FieldRow label="Latitude" value={formatCoord(camera.lat)} />
          <FieldRow label="Longitude" value={formatCoord(camera.lng)} />
          <FieldRow
            label="Fix accuracy"
            value={camera.accuracy === null ? "placed by hand" : formatAccuracy(camera.accuracy)}
            tone={
              camera.accuracy === null
                ? "muted"
                : quality === "excellent" || quality === "good"
                  ? "good"
                  : "warn"
            }
          />
          <FieldRow
            label="Captured"
            value={new Date(camera.capturedAt).toLocaleString()}
            tone="muted"
          />
          <FieldRow
            label="Submitted"
            value={new Date(camera.createdAt).toLocaleString()}
            tone="muted"
          />
          <FieldRow
            label="Submitted by"
            value={camera.submittedBy ?? "anonymous"}
            tone="muted"
          />
          <FieldRow label="Record" value={camera.id} tone="muted" />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Button variant="ghost" onClick={copyCoords}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy coordinates"}
          </Button>
          <a
            href={`https://www.openstreetmap.org/?mlat=${camera.lat}&mlon=${camera.lng}#map=19/${camera.lat}/${camera.lng}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rule px-4 text-sm font-medium text-ink transition-colors hover:bg-raised"
          >
            <ExternalLink className="size-4" />
            Open in OpenStreetMap
          </a>
        </div>

        {/* Deleting is destructive and irreversible, so it sits apart from the
            other actions, behind a confirm, and never shows for someone who
            cannot do it. canDelete comes from the server. */}
        {camera.canDelete ? (
          <div className="border-t border-rule pt-5">
            {deleteError ? (
              <div className="mb-3">
                <Notice
                  tone="bad"
                  icon={<TriangleAlert className="size-4" />}
                  title={deleteError}
                />
              </div>
            ) : null}

            {confirming ? (
              <div className="space-y-3">
                <p className="text-[0.8125rem] leading-relaxed text-ink">
                  Delete this camera and its photo? This cannot be undone.
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                    Keep it
                  </Button>
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={deleting}
                    aria-busy={deleting || undefined}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-fix-bad px-4 text-sm font-medium text-void transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-fix-bad/40 px-4 text-sm font-medium text-fix-bad transition-colors hover:bg-fix-bad/10"
              >
                <Trash2 className="size-4" />
                Delete this camera
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
