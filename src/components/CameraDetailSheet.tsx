"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { SightlineGlyph } from "@/components/SightlineGlyph";
import { Button, FieldRow, Sheet } from "@/components/ui/primitives";
import { formatAccuracy, formatBearing, formatCoord, fixQuality } from "@/lib/geo";
import type { CameraDTO } from "@/lib/types";

export function CameraDetailSheet({
  camera,
  onClose,
}: {
  camera: CameraDTO | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

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
      </div>
    </Sheet>
  );
}
