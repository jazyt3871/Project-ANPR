"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Fix = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};

export type GeoStatus = "idle" | "locating" | "ready" | "error" | "unsupported";

export type GeoErrorCode = "denied" | "unavailable" | "timeout" | "unknown";

export type GeoError = { code: GeoErrorCode; message: string };

const MESSAGES: Record<GeoErrorCode, string> = {
  denied:
    "Location access is blocked. Enable it for this site in your browser settings, then try again.",
  unavailable:
    "No position available. Step into the open, away from buildings, and try again.",
  timeout: "The GPS took too long to answer. Try again.",
  unknown: "Location lookup failed.",
};

function toGeoError(err: GeolocationPositionError): GeoError {
  const code: GeoErrorCode =
    err.code === err.PERMISSION_DENIED
      ? "denied"
      : err.code === err.POSITION_UNAVAILABLE
        ? "unavailable"
        : err.code === err.TIMEOUT
          ? "timeout"
          : "unknown";
  return { code, message: MESSAGES[code] };
}

/** How long to keep refining before giving up on a better reading. */
const REFINE_WINDOW_MS = 45_000;

/**
 * Watches position at high accuracy and keeps the tightest reading seen.
 *
 * A single getCurrentPosition call on a cold GPS often returns a 500 m
 * wifi-derived guess. watchPosition lets the accuracy converge over a few
 * seconds while the user watches the meter, which is the difference between a
 * marker on the right side of the street and one on the wrong block.
 */
export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [latest, setLatest] = useState<Fix | null>(null);
  const [best, setBest] = useState<Fix | null>(null);
  const [error, setError] = useState<GeoError | null>(null);

  const watchId = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      setError({
        code: "unavailable",
        message: "This browser has no Geolocation API.",
      });
      return;
    }

    stop();
    setError(null);
    setStatus("locating");
    setBest(null);
    setLatest(null);
    startedAt.current = Date.now();

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setLatest(fix);
        setBest((prev) => (prev === null || fix.accuracy < prev.accuracy ? fix : prev));
        setStatus("ready");
      },
      (err) => {
        setError(toGeoError(err));
        // A timeout after we already have a usable fix isn't fatal.
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000,
      },
    );

    // Stop draining the battery once the reading has had time to settle.
    stopTimer.current = setTimeout(stop, REFINE_WINDOW_MS);
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setStatus("idle");
    setLatest(null);
    setBest(null);
    setError(null);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    status,
    /** Tightest accuracy seen this session — the one to submit. */
    best,
    /** Most recent raw reading, for the live meter. */
    latest,
    error,
    start,
    stop,
    reset,
    isRefining: status === "locating" || (status === "ready" && watchId.current !== null),
  };
}
