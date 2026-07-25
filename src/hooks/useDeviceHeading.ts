"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { circularMean, normalizeBearing } from "@/lib/geo";

export type CompassPermission =
  | "unknown"
  | "unsupported"
  | "prompt"
  | "granted"
  | "denied";

export type CompassStatus =
  | "idle"
  | "waiting" // permission granted, no events yet
  | "live"
  | "no-signal" // permission granted but the sensor never reported
  | "denied"
  | "unsupported";

/** Non-standard fields Safari adds to DeviceOrientationEvent. */
type SafariOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type IosPermissionApi = {
  requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
};

const SMOOTHING_SAMPLES = 8;
const NO_SIGNAL_TIMEOUT_MS = 3500;

function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") return angle;
  // Deprecated, but still the only option on some older Android browsers.
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

/**
 * Convert a DeviceOrientationEvent into a compass bearing: degrees clockwise
 * from true north, in the direction the top of the phone is pointing.
 *
 * Two very different paths:
 *   iOS Safari  — `webkitCompassHeading` is already a true-north bearing.
 *   Chromium    — `alpha` from `deviceorientationabsolute` rotates
 *                 counter-clockwise from north, so it has to be inverted, then
 *                 corrected for however the OS has rotated the viewport.
 */
function toBearing(event: SafariOrientationEvent): number | null {
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return normalizeBearing(event.webkitCompassHeading);
  }
  if (typeof event.alpha === "number" && !Number.isNaN(event.alpha)) {
    return normalizeBearing(360 - event.alpha + screenAngle());
  }
  return null;
}

/**
 * Live compass bearing with a manual fallback.
 *
 * The manual path is not a nicety: desktop browsers have no magnetometer,
 * plenty of Android devices ship an uncalibrated one, and users can decline the
 * iOS prompt. A dial the user can drag is always available.
 */
export function useDeviceHeading() {
  const [permission, setPermission] = useState<CompassPermission>("unknown");
  const [status, setStatus] = useState<CompassStatus>("idle");
  const [bearing, setBearing] = useState<number | null>(null);
  const [sensorAccuracy, setSensorAccuracy] = useState<number | null>(null);
  const [isAbsolute, setIsAbsolute] = useState<boolean | null>(null);

  const samples = useRef<number[]>([]);
  const attached = useRef(false);
  const signalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const detach = useCallback(() => {
    if (handlerRef.current) {
      window.removeEventListener("deviceorientationabsolute", handlerRef.current);
      window.removeEventListener("deviceorientation", handlerRef.current);
      handlerRef.current = null;
    }
    if (signalTimer.current) {
      clearTimeout(signalTimer.current);
      signalTimer.current = null;
    }
    attached.current = false;
    samples.current = [];
  }, []);

  const attach = useCallback(() => {
    if (attached.current) return;
    attached.current = true;
    setStatus("waiting");

    const handler = (raw: DeviceOrientationEvent) => {
      const event = raw as SafariOrientationEvent;
      const next = toBearing(event);
      if (next === null) return;

      if (signalTimer.current) {
        clearTimeout(signalTimer.current);
        signalTimer.current = null;
      }

      setIsAbsolute(
        typeof event.webkitCompassHeading === "number" ? true : event.absolute ?? null,
      );
      if (typeof event.webkitCompassAccuracy === "number") {
        // Safari reports -1 while the magnetometer is still uncalibrated.
        setSensorAccuracy(
          event.webkitCompassAccuracy < 0 ? null : event.webkitCompassAccuracy,
        );
      }

      samples.current = [...samples.current, next].slice(-SMOOTHING_SAMPLES);
      const smoothed = circularMean(samples.current);
      if (smoothed !== null) setBearing(smoothed);
      setStatus("live");
    };

    handlerRef.current = handler;

    // `deviceorientationabsolute` is the true-north stream on Chromium.
    // Safari doesn't fire it but puts a true-north value on the plain event.
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);

    signalTimer.current = setTimeout(() => {
      setStatus((prev) => (prev === "live" ? prev : "no-signal"));
    }, NO_SIGNAL_TIMEOUT_MS);
  }, []);

  /** Must be called from a user gesture — iOS rejects the prompt otherwise. */
  const request = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      setPermission("unsupported");
      setStatus("unsupported");
      return false;
    }

    const api = window.DeviceOrientationEvent as unknown as IosPermissionApi;

    if (typeof api.requestPermission === "function") {
      try {
        const result = await api.requestPermission();
        if (result !== "granted") {
          setPermission("denied");
          setStatus("denied");
          return false;
        }
      } catch {
        // Thrown when not called from a gesture, or on an insecure origin.
        setPermission("denied");
        setStatus("denied");
        return false;
      }
    }

    setPermission("granted");
    attach();
    return true;
  }, [attach]);

  /** True when iOS will show a permission sheet, so the UI must ask first. */
  const needsPermissionPrompt =
    typeof window !== "undefined" &&
    "DeviceOrientationEvent" in window &&
    typeof (window.DeviceOrientationEvent as unknown as IosPermissionApi).requestPermission ===
      "function" &&
    permission !== "granted";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("DeviceOrientationEvent" in window)) {
      setPermission("unsupported");
      setStatus("unsupported");
      return;
    }
    const api = window.DeviceOrientationEvent as unknown as IosPermissionApi;
    setPermission(typeof api.requestPermission === "function" ? "prompt" : "granted");
  }, []);

  useEffect(() => detach, [detach]);

  return {
    permission,
    status,
    bearing,
    sensorAccuracy,
    /** false means the reading is relative to where the device started, not north. */
    isAbsolute,
    needsPermissionPrompt,
    request,
    /** Start listening without a prompt (non-iOS). */
    attach,
    stop: detach,
  };
}
