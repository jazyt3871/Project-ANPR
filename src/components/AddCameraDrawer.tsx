"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, MapPin } from "lucide-react";
import { StepHeading } from "@/components/steps/StepHeading";
import { StepLocation } from "@/components/steps/StepLocation";
import { StepPhoto } from "@/components/steps/StepPhoto";
import { StepReview } from "@/components/steps/StepReview";
import { Button, cx, Sheet } from "@/components/ui/primitives";
import { useDeviceHeading } from "@/hooks/useDeviceHeading";
import { useGeolocation, type Fix } from "@/hooks/useGeolocation";
import type { PreparedPhoto } from "@/lib/image";
import {
  emptyDraft,
  type CameraDTO,
  type DraftCamera,
  type HeadingSource,
} from "@/lib/types";

const STEPS = [
  { key: "location", title: "Lock the location", eyebrow: "Step 1 of 4" },
  { key: "heading", title: "Point at the camera", eyebrow: "Step 2 of 4" },
  { key: "photo", title: "Photograph it", eyebrow: "Step 3 of 4" },
  { key: "review", title: "Check and save", eyebrow: "Step 4 of 4" },
] as const;

export type AddCameraDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSaved: (camera: CameraDTO) => void;
  /** Set while the user is picking a point on the map; the sheet collapses to a bar. */
  pickMode: boolean;
  onEnterPickMode: () => void;
  onExitPickMode: () => void;
  /** Coordinates handed back after a map tap. */
  pickedPoint: { lat: number; lng: number } | null;
  onFixChange: (fix: Fix | null) => void;
};

export function AddCameraDrawer({
  open,
  onClose,
  onSaved,
  pickMode,
  onEnterPickMode,
  onExitPickMode,
  pickedPoint,
  onFixChange,
}: AddCameraDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<DraftCamera>(emptyDraft);
  const [manualPoint, setManualPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const geo = useGeolocation();
  const compass = useDeviceHeading();

  // Stable identities: the hooks memoize these functions, the objects they
  // arrive in are new on every render.
  const { start: startGeo, stop: stopGeo, reset: resetGeo } = geo;
  const { stop: stopCompass } = compass;

  // Object URLs are released explicitly rather than from inside a state
  // updater, which React is free to invoke more than once.
  const previewUrlRef = useRef<string | null>(null);
  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const step = STEPS[stepIndex];

  /* Mirror the live fix onto the map so the user can see where they are. */
  useEffect(() => {
    onFixChange(geo.best ?? geo.latest ?? null);
  }, [geo.best, geo.latest, onFixChange]);

  /* A map tap in pick mode becomes the draft position. Ref-guarded so the
     effect stays idempotent if it re-runs. */
  const appliedPick = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!pickedPoint || appliedPick.current === pickedPoint) return;
    appliedPick.current = pickedPoint;
    setManualPoint(pickedPoint);
    setDraft((d) => ({
      ...d,
      lat: pickedPoint.lat,
      lng: pickedPoint.lng,
      accuracy: null,
      capturedAt: d.capturedAt ?? new Date().toISOString(),
    }));
    stopGeo();
    onExitPickMode();
  }, [pickedPoint, stopGeo, onExitPickMode]);

  const reset = useCallback(() => {
    resetGeo();
    stopCompass();
    releasePreview();
    setDraft(emptyDraft);
    setManualPoint(null);
    appliedPick.current = null;
    setStepIndex(0);
    setSubmitError(null);
    onFixChange(null);
  }, [resetGeo, stopCompass, releasePreview, onFixChange]);

  const close = useCallback(() => {
    onExitPickMode();
    reset();
    onClose();
  }, [onClose, onExitPickMode, reset]);

  const canAdvance = useMemo(() => {
    switch (step.key) {
      case "location":
        return draft.lat !== null && draft.lng !== null;
      case "heading":
        return draft.heading !== null;
      case "photo":
        return draft.photo !== null;
      default:
        return true;
    }
  }, [step.key, draft]);

  /* ----------------------------------------------------------- handlers -- */

  function applyFix(fix: Fix) {
    setManualPoint(null);
    appliedPick.current = null;
    setDraft((d) => ({
      ...d,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      capturedAt: new Date(fix.timestamp).toISOString(),
    }));
    setStepIndex(1);
  }

  function lockHeading(bearing: number, source: HeadingSource, is360 = false) {
    setDraft((d) => ({ ...d, heading: bearing, headingSource: source, is360 }));
    stopCompass();
    setStepIndex(2);
  }

  function acceptPhoto(photo: PreparedPhoto) {
    releasePreview();
    previewUrlRef.current = photo.previewUrl;
    setDraft((d) => ({
      ...d,
      photo: photo.blob,
      photoPreviewUrl: photo.previewUrl,
      photoWidth: photo.width,
      photoHeight: photo.height,
    }));
  }

  function clearPhoto() {
    releasePreview();
    setDraft((d) => ({
      ...d,
      photo: null,
      photoPreviewUrl: null,
      photoWidth: null,
      photoHeight: null,
    }));
  }

  async function submit() {
    if (draft.lat === null || draft.lng === null || draft.heading === null || !draft.photo) {
      setSubmitError("Something is still missing. Step back and check each field.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const body = new FormData();
    body.set("lat", String(draft.lat));
    body.set("lng", String(draft.lng));
    if (draft.accuracy !== null) body.set("accuracy", String(draft.accuracy));
    body.set("heading", String(draft.heading));
    body.set("headingSource", draft.headingSource);
    body.set("is360", String(draft.is360));
    if (draft.note.trim()) body.set("note", draft.note.trim());
    if (draft.photoWidth) body.set("photoWidth", String(draft.photoWidth));
    if (draft.photoHeight) body.set("photoHeight", String(draft.photoHeight));
    body.set("capturedAt", draft.capturedAt ?? new Date().toISOString());
    body.set("photo", draft.photo, "camera.jpg");

    try {
      const res = await fetch("/api/cameras", { method: "POST", body });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setSubmitError(payload?.error ?? `The server rejected the submission (${res.status}).`);
        return;
      }

      onSaved(payload.camera as CameraDTO);
      close();
    } catch {
      setSubmitError(
        "The request never reached the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* --------------------------------------------------------------- render -- */

  // While picking a point the sheet shrinks to a bar so the map stays usable.
  if (open && pickMode) {
    return (
      <div
        className="fixed inset-x-0 z-[1000] px-4"
        style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div
          className="sheet-rise mx-auto flex max-w-md items-center gap-3 rounded-xl border border-rule bg-panel px-4 py-3"
          style={{ boxShadow: "var(--shadow-lift)" }}
        >
          <MapPin className="size-[18px] shrink-0 text-sodium" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-ink">
            Tap the map where the camera is.
          </p>
          <Button variant="quiet" onClick={onExitPickMode}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={step.title} eyebrow={step.eyebrow}>
      {/* Four segments because the flow is genuinely four ordered stages —
          each one depends on the one before it. */}
      <div className="mb-5 flex gap-1.5" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={cx(
              "h-0.5 flex-1 rounded-full transition-colors",
              i < stepIndex ? "bg-sodium" : i === stepIndex ? "bg-sodium/60" : "bg-rule",
            )}
          />
        ))}
      </div>

      {step.key === "location" ? (
        <StepLocation
          status={geo.status}
          latest={geo.latest}
          best={geo.best}
          error={geo.error}
          onStart={() => {
            setManualPoint(null);
            appliedPick.current = null;
            startGeo();
          }}
          onUse={applyFix}
          onPickByHand={onEnterPickMode}
          manual={manualPoint}
        />
      ) : null}

      {step.key === "heading" ? (
        <StepHeading compass={compass} locked={draft.heading} onLock={lockHeading} />
      ) : null}

      {step.key === "photo" ? (
        <StepPhoto
          previewUrl={draft.photoPreviewUrl}
          onPhoto={acceptPhoto}
          onClear={clearPhoto}
        />
      ) : null}

      {step.key === "review" ? (
        <StepReview
          draft={draft}
          onNoteChange={(note) => setDraft((d) => ({ ...d, note }))}
          onSubmit={submit}
          submitting={submitting}
          error={submitError}
        />
      ) : null}

      {/* Steps 1 and 2 own their primary action, so only Back and the step-3
          Continue live in the footer. */}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-rule pt-4">
        <Button
          variant="quiet"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
        >
          <ChevronLeft className="size-4" />
          Back
        </Button>

        {step.key === "location" && manualPoint ? (
          <Button onClick={() => setStepIndex(1)} disabled={!canAdvance}>
            Continue
          </Button>
        ) : null}

        {step.key === "photo" ? (
          <Button onClick={() => setStepIndex(3)} disabled={!canAdvance}>
            Continue
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
