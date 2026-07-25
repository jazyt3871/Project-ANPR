"use client";

import { useState } from "react";
import { Compass, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { CompassDial } from "@/components/CompassDial";
import { Button, Notice } from "@/components/ui/primitives";
import { formatBearing } from "@/lib/geo";
import type { CompassStatus, useDeviceHeading } from "@/hooks/useDeviceHeading";
import type { HeadingSource } from "@/lib/types";

type CompassApi = ReturnType<typeof useDeviceHeading>;

export type StepHeadingProps = {
  compass: CompassApi;
  /** Bearing already locked in for this draft, if the user has been here before. */
  locked: number | null;
  onLock: (bearing: number, source: HeadingSource) => void;
};

/** Statuses where the live sensor cannot produce a bearing at all. */
const SENSOR_DEAD: CompassStatus[] = ["denied", "unsupported", "no-signal"];

export function StepHeading({ compass, locked, onLock }: StepHeadingProps) {
  const [manualMode, setManualMode] = useState(false);
  const [manualBearing, setManualBearing] = useState<number>(locked ?? 0);
  const [requesting, setRequesting] = useState(false);

  const sensorDead = SENSOR_DEAD.includes(compass.status);
  const useManual = manualMode || sensorDead;
  const shown = useManual ? manualBearing : compass.bearing;

  async function enable() {
    setRequesting(true);
    const ok = await compass.request();
    setRequesting(false);
    if (!ok) setManualMode(true);
  }

  const notStarted = compass.status === "idle";

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-graphite">
        {useManual
          ? "Turn the dial until the cone points the way the camera looks."
          : "Hold the phone flat and point its top edge the way the camera looks. Lock the bearing when the dial settles."}
      </p>

      <CompassDial
        bearing={shown}
        interactive={useManual}
        onChange={setManualBearing}
        idle={notStarted && !useManual}
        sensorAccuracy={useManual ? null : compass.sensorAccuracy}
      />

      {/* --- sensor state ---------------------------------------------------- */}

      {notStarted && !useManual ? (
        <Button size="lg" onClick={enable} loading={requesting} className="w-full">
          <Compass className="size-[18px]" />
          {requesting ? "Waiting for permission…" : "Turn on the compass"}
        </Button>
      ) : null}

      {compass.status === "waiting" ? (
        <Notice tone="info" title="Waiting for the first reading">
          Move the phone in a slow figure eight — that is how the magnetometer calibrates
          itself.
        </Notice>
      ) : null}

      {compass.status === "denied" ? (
        <Notice
          tone="warn"
          icon={<TriangleAlert className="size-4" />}
          title="Motion access was declined"
        >
          On iOS, re-enable it under Settings → Safari → Motion &amp; Orientation Access,
          then reload. The dial above works without it.
        </Notice>
      ) : null}

      {compass.status === "unsupported" ? (
        <Notice tone="info" icon={<Compass className="size-4" />} title="No compass on this device">
          Set the bearing on the dial instead. It is saved as a manual reading.
        </Notice>
      ) : null}

      {compass.status === "no-signal" ? (
        <Notice
          tone="warn"
          icon={<TriangleAlert className="size-4" />}
          title="Permission was granted but no readings arrived"
        >
          The magnetometer may be missing or disabled. Use the dial instead.
        </Notice>
      ) : null}

      {compass.status === "live" && compass.isAbsolute === false ? (
        <Notice
          tone="warn"
          icon={<TriangleAlert className="size-4" />}
          title="This reading is not referenced to north"
        >
          The device is reporting orientation relative to where it started, so the number
          above is not a true bearing. Check it against a known direction, or set it on the
          dial.
        </Notice>
      ) : null}

      {compass.status === "live" &&
      compass.sensorAccuracy != null &&
      compass.sensorAccuracy > 15 ? (
        <Notice
          tone="warn"
          icon={<TriangleAlert className="size-4" />}
          title={`The compass reports ±${Math.round(compass.sensorAccuracy)}° of error`}
        >
          Move away from cars, railings, and anything magnetic, then trace a figure eight.
        </Notice>
      ) : null}

      {/* --- actions --------------------------------------------------------- */}

      <div className="space-y-2.5">
        <Button
          size="lg"
          onClick={() => shown !== null && onLock(shown, useManual ? "manual" : "sensor")}
          disabled={shown === null}
          className="w-full"
        >
          <Lock className="size-[18px]" />
          {shown === null ? "No bearing yet" : `Lock ${formatBearing(shown)}`}
        </Button>

        {!sensorDead ? (
          <Button
            variant="quiet"
            onClick={() => {
              setManualMode((m) => !m);
              if (!manualMode && compass.bearing !== null) setManualBearing(compass.bearing);
            }}
            className="w-full"
          >
            <RotateCcw className="size-4" />
            {manualMode ? "Go back to the live compass" : "Set the bearing by hand"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
