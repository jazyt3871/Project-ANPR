"use client";

import { TriangleAlert, Upload } from "lucide-react";
import { Button, FieldRow, Notice } from "@/components/ui/primitives";
import { SightlineGlyph } from "@/components/SightlineGlyph";
import { formatAccuracy, formatBearing, formatCoord, fixQuality } from "@/lib/geo";
import type { DraftCamera } from "@/lib/types";

export type StepReviewProps = {
  draft: DraftCamera;
  onNoteChange: (note: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
};

const NOTE_LIMIT = 280;

export function StepReview({
  draft,
  onNoteChange,
  onSubmit,
  submitting,
  error,
}: StepReviewProps) {
  const quality = fixQuality(draft.accuracy);
  const coarse = draft.accuracy != null && (quality === "poor" || quality === "unusable");

  return (
    <div className="space-y-5">
      {/* The same glyph that will appear on the map, so there is no surprise. */}
      <div className="flex items-center gap-4 rounded-xl border border-rule bg-raised p-4">
        <SightlineGlyph bearing={draft.heading ?? 0} size={84} is360={draft.is360} />
        <div className="min-w-0">
          <p className="eyebrow mb-1">{draft.is360 ? "Coverage" : "Bearing"}</p>
          <p className="readout text-2xl leading-none font-medium text-ink">
            {draft.is360
              ? "360°"
              : draft.heading === null
                ? "—"
                : formatBearing(draft.heading)}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-graphite">
            {draft.is360
              ? "Dome / panoramic — every direction"
              : draft.headingSource === "manual"
                ? "Set by hand"
                : "Read from the compass"}
          </p>
        </div>
      </div>

      {draft.photoPreviewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={draft.photoPreviewUrl}
          alt="The photo about to be submitted"
          className="max-h-[32dvh] w-full rounded-xl border border-rule object-contain"
        />
      ) : null}

      <div>
        <FieldRow
          label="Latitude"
          value={draft.lat === null ? "—" : formatCoord(draft.lat)}
        />
        <FieldRow
          label="Longitude"
          value={draft.lng === null ? "—" : formatCoord(draft.lng)}
        />
        <FieldRow
          label="Accuracy"
          value={draft.accuracy === null ? "not recorded" : formatAccuracy(draft.accuracy)}
          tone={draft.accuracy === null ? "muted" : coarse ? "warn" : "good"}
        />
        <FieldRow
          label="Captured"
          value={
            draft.capturedAt ? new Date(draft.capturedAt).toLocaleString() : "just now"
          }
          tone="muted"
        />
      </div>

      <div>
        <label htmlFor="note" className="eyebrow mb-2 block">
          Note (optional)
        </label>
        <textarea
          id="note"
          rows={3}
          maxLength={NOTE_LIMIT}
          value={draft.note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Mounted under the second-floor awning, facing the crosswalk."
          className="w-full resize-none rounded-lg border border-rule bg-panel px-3 py-2.5 text-sm text-ink placeholder:text-graphite/70 focus:border-sodium focus:outline-none"
        />
        <p className="readout mt-1.5 text-right text-[0.6875rem] text-graphite">
          {draft.note.length}/{NOTE_LIMIT}
        </p>
      </div>

      {coarse ? (
        <Notice
          tone="warn"
          icon={<TriangleAlert className="size-4" />}
          title={`Saving with a ${formatAccuracy(draft.accuracy)} fix`}
        >
          The radius is stored with the point, so anyone reading the map can see how
          precise it is.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="bad" icon={<TriangleAlert className="size-4" />} title="The camera was not saved">
          {error}
        </Notice>
      ) : null}

      <Button size="lg" onClick={onSubmit} loading={submitting} className="w-full">
        <Upload className="size-[18px]" />
        {submitting ? "Saving…" : "Save camera"}
      </Button>
    </div>
  );
}
