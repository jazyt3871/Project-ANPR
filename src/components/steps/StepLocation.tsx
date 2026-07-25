"use client";

import { Crosshair, Hand, LocateFixed, TriangleAlert } from "lucide-react";
import { Button, FieldRow, Notice } from "@/components/ui/primitives";
import { formatAccuracy, formatCoord, fixQuality } from "@/lib/geo";
import type { Fix, GeoError, GeoStatus } from "@/hooks/useGeolocation";

const BAND_COPY = {
  excellent: { label: "Street level", tone: "good" as const },
  good: { label: "Good enough", tone: "good" as const },
  poor: { label: "Too coarse to place a camera", tone: "warn" as const },
  unusable: { label: "Unusable", tone: "bad" as const },
};

/** Accuracy at which the meter bar is full. Anything tighter is equally fine. */
const METER_FLOOR_M = 5;
const METER_CEILING_M = 100;

function meterFill(accuracy: number): number {
  const clamped = Math.min(Math.max(accuracy, METER_FLOOR_M), METER_CEILING_M);
  return 1 - (clamped - METER_FLOOR_M) / (METER_CEILING_M - METER_FLOOR_M);
}

export type StepLocationProps = {
  status: GeoStatus;
  latest: Fix | null;
  best: Fix | null;
  error: GeoError | null;
  onStart: () => void;
  onUse: (fix: Fix) => void;
  onPickByHand: () => void;
  /** Set when the position came from a map tap rather than the GPS. */
  manual: { lat: number; lng: number } | null;
};

export function StepLocation({
  status,
  latest,
  best,
  error,
  onStart,
  onUse,
  onPickByHand,
  manual,
}: StepLocationProps) {
  const reading = latest ?? best;
  const quality = fixQuality(best?.accuracy);
  const band = BAND_COPY[quality];

  if (manual) {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-graphite">
          This position came from the map, not the GPS. It is stored without an accuracy
          radius.
        </p>
        <div>
          <FieldRow label="Latitude" value={formatCoord(manual.lat)} />
          <FieldRow label="Longitude" value={formatCoord(manual.lng)} />
          <FieldRow label="Accuracy" value="not recorded" tone="muted" />
        </div>
        <Button variant="ghost" onClick={onStart} className="w-full">
          <LocateFixed className="size-4" />
          Use the GPS instead
        </Button>
      </div>
    );
  }

  if (status === "idle" || status === "unsupported") {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-graphite">
          Stand as close to the camera as you can get. The reading tightens over a few
          seconds — wait for it before you continue.
        </p>

        {status === "unsupported" ? (
          <Notice
            tone="bad"
            icon={<TriangleAlert className="size-4" />}
            title="This browser has no Geolocation API"
          >
            Place the pin on the map by hand instead.
          </Notice>
        ) : null}

        <div className="space-y-2.5">
          {status === "idle" ? (
            <Button size="lg" onClick={onStart} className="w-full">
              <Crosshair className="size-[18px]" />
              Start a GPS fix
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onPickByHand} className="w-full">
            <Hand className="size-4" />
            Place the pin by hand
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Live meter. Accuracy is a radius, so it is shown as one and never rounded away. */}
      <div className="rounded-xl border border-rule bg-raised p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="eyebrow">Horizontal accuracy</span>
          <span
            className="readout text-2xl font-medium"
            style={{
              color:
                band.tone === "good"
                  ? "var(--fix-good)"
                  : band.tone === "warn"
                    ? "var(--fix-warn)"
                    : "var(--fix-bad)",
            }}
          >
            {best ? formatAccuracy(best.accuracy) : "—"}
          </span>
        </div>

        <div className="relative h-1.5 overflow-hidden rounded-full bg-rule">
          {best ? (
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.round(meterFill(best.accuracy) * 100)}%`,
                background:
                  band.tone === "good"
                    ? "var(--fix-good)"
                    : band.tone === "warn"
                      ? "var(--fix-warn)"
                      : "var(--fix-bad)",
              }}
            />
          ) : (
            <div className="sweep-bar absolute inset-0" />
          )}
        </div>

        <p className="mt-2.5 text-[0.75rem] text-graphite">
          {best ? band.label : "Waiting for the first reading"}
          {latest && best && latest.accuracy > best.accuracy ? " · still refining" : ""}
        </p>
      </div>

      {reading ? (
        <div>
          <FieldRow label="Latitude" value={formatCoord((best ?? reading).lat)} />
          <FieldRow label="Longitude" value={formatCoord((best ?? reading).lng)} />
          <FieldRow
            label="Fixed at"
            value={new Date((best ?? reading).timestamp).toLocaleTimeString()}
            tone="muted"
          />
        </div>
      ) : null}

      {error ? (
        <Notice
          tone={error.code === "denied" ? "bad" : "warn"}
          icon={<TriangleAlert className="size-4" />}
          title={
            error.code === "denied" ? "Location access is blocked" : "The GPS is struggling"
          }
          action={
            <button
              type="button"
              onClick={onPickByHand}
              className="text-[0.8125rem] font-medium text-sodium underline underline-offset-2"
            >
              Place the pin by hand
            </button>
          }
        >
          {error.message}
        </Notice>
      ) : null}

      {quality === "poor" || quality === "unusable" ? (
        <Notice
          tone={quality === "unusable" ? "bad" : "warn"}
          icon={<TriangleAlert className="size-4" />}
          title={`A ${formatAccuracy(best?.accuracy)} fix can land on the wrong building`}
        >
          Move into the open, away from glass and overhangs, and give it a few more
          seconds. You can continue anyway — the radius is stored alongside the point.
        </Notice>
      ) : null}

      <div className="space-y-2.5">
        <Button
          size="lg"
          onClick={() => best && onUse(best)}
          disabled={!best}
          className="w-full"
        >
          <LocateFixed className="size-[18px]" />
          {best ? `Use this location (${formatAccuracy(best.accuracy)})` : "Waiting for a fix"}
        </Button>
        <Button variant="quiet" onClick={onPickByHand} className="w-full">
          Place the pin by hand instead
        </Button>
      </div>
    </div>
  );
}
