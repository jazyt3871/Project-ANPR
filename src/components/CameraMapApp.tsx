"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cctv, LocateFixed, Moon, Plus, Sun, TriangleAlert } from "lucide-react";
import { AddCameraDrawer } from "@/components/AddCameraDrawer";
import { CameraDetailSheet } from "@/components/CameraDetailSheet";
import { cx } from "@/components/ui/primitives";
import type { Fix } from "@/hooks/useGeolocation";
import type { CameraDTO } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-void">
      <p className="eyebrow animate-pulse">Loading the map</p>
    </div>
  ),
});

const BBOX_DEBOUNCE_MS = 350;
const THEME_KEY = "sightline:theme";

export function CameraMapApp() {
  /* Merged store: panning away and back shouldn't make markers blink out. */
  const [cameras, setCameras] = useState<Map<string, CameraDTO>>(new Map());
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [userFix, setUserFix] = useState<Fix | null>(null);
  const [recenterToken, setRecenterToken] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  /* --------------------------------------------------------------- theme -- */
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    setTheme(stored === "light" ? "light" : "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.classList.toggle("light", next === "light");
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* private mode — the theme just won't persist */
      }
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- data -- */
  const load = useCallback(async (bbox: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/cameras?bbox=${encodeURIComponent(bbox)}&limit=500`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const payload: { cameras: CameraDTO[] } = await res.json();

      setCameras((prev) => {
        const next = new Map(prev);
        for (const camera of payload.cameras) next.set(camera.id, camera);
        return next;
      });
      setVisibleCount(payload.cameras.length);
      setFetchError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setFetchError("Could not reach the server. Pan the map to retry.");
    } finally {
      if (inFlight.current === controller) {
        setLoading(false);
        inFlight.current = null;
      }
    }
  }, []);

  const handleBBoxChange = useCallback(
    (bbox: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void load(bbox), BBOX_DEBOUNCE_MS);
    },
    [load],
  );

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      inFlight.current?.abort();
    },
    [],
  );

  /* ------------------------------------------------------------ handlers -- */
  const cameraList = useMemo(() => [...cameras.values()], [cameras]);
  const selected = selectedId ? cameras.get(selectedId) ?? null : null;

  const enterPickMode = useCallback(() => {
    setPickedPoint(null);
    setPickMode(true);
  }, []);

  const exitPickMode = useCallback(() => setPickMode(false), []);

  const handlePick = useCallback((lat: number, lng: number) => {
    setPickedPoint({ lat, lng });
  }, []);

  const handleFixChange = useCallback((fix: Fix | null) => setUserFix(fix), []);

  const handleSaved = useCallback((camera: CameraDTO) => {
    setCameras((prev) => new Map(prev).set(camera.id, camera));
    setVisibleCount((n) => n + 1);
    setSelectedId(camera.id);
  }, []);

  const locateMe = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
        setRecenterToken((n) => n + 1);
      },
      () => setFetchError("Could not read your location. Check the site's permissions."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  /* -------------------------------------------------------------- render -- */
  const isEmpty = cameraList.length === 0 && !loading && !fetchError;

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-void">
      <MapView
        cameras={cameraList}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onBBoxChange={handleBBoxChange}
        userFix={userFix}
        pickMode={pickMode}
        onPick={handlePick}
        theme={theme}
        recenterToken={recenterToken}
      />

      {/* Instrument strip. Everything measured is set in mono. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div
          className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-rule bg-panel/92 px-3 py-2.5 backdrop-blur-md"
          style={{ boxShadow: "var(--shadow-lift)" }}
        >
          <span className="flex items-center gap-2">
            <Cctv className="size-[18px] shrink-0 text-sodium" strokeWidth={1.75} />
            <span
              className="readout text-[0.8125rem] font-semibold tracking-[0.2em] text-ink"
              style={{ letterSpacing: "0.2em" }}
            >
              SIGHTLINE
            </span>
          </span>

          <span className="ml-auto flex items-center gap-2 text-right">
            <span
              className={cx(
                "size-1.5 rounded-full transition-colors",
                loading ? "bg-sodium" : fetchError ? "bg-fix-bad" : "bg-fix-good",
              )}
              aria-hidden="true"
            />
            <span className="readout text-[0.6875rem] whitespace-nowrap text-graphite">
              {loading ? "loading" : `${visibleCount} in view`}
            </span>
          </span>

          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={locateMe}
              aria-label="Centre the map on my location"
              className="grid size-9 place-items-center rounded-lg text-graphite transition-colors hover:bg-raised hover:text-ink"
            >
              <LocateFixed className="size-[18px]" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
              className="grid size-9 place-items-center rounded-lg text-graphite transition-colors hover:bg-raised hover:text-ink"
            >
              {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </button>
          </span>
        </div>

        {fetchError ? (
          <div
            className="pointer-events-auto mx-auto mt-2 flex max-w-3xl items-center gap-2 rounded-xl border border-fix-bad/35 bg-fix-bad/10 px-3 py-2"
            role="status"
          >
            <TriangleAlert className="size-4 shrink-0 text-fix-bad" />
            <p className="text-[0.8125rem] text-fix-bad">{fetchError}</p>
          </div>
        ) : null}
      </header>

      {/* An empty map is an invitation, not a dead end. */}
      {isEmpty && !drawerOpen ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[400] -translate-y-1/2 px-6">
          <div className="mx-auto max-w-xs text-center">
            <p className="text-[0.9375rem] leading-relaxed text-ink">
              No cameras mapped here yet.
            </p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-graphite">
              Stand next to one, point your phone the way it looks, and add the first.
            </p>
          </div>
        </div>
      ) : null}

      {/* FAB. Thumb-reachable, above the safe area, out of the way of the
          attribution and the zoom control. */}
      {!drawerOpen ? (
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setDrawerOpen(true);
          }}
          className="absolute right-4 z-[600] flex h-14 items-center gap-2.5 rounded-full bg-sodium pr-5 pl-4 text-sodium-ink transition-transform active:scale-95"
          style={{
            bottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))",
            boxShadow: "var(--shadow-lift)",
          }}
        >
          <Plus className="size-6" strokeWidth={2.25} />
          <span className="text-[0.9375rem] font-semibold">Add camera</span>
        </button>
      ) : null}

      <AddCameraDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
        pickMode={pickMode}
        onEnterPickMode={enterPickMode}
        onExitPickMode={exitPickMode}
        pickedPoint={pickedPoint}
        onFixChange={handleFixChange}
      />

      {!drawerOpen ? (
        <CameraDetailSheet camera={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </main>
  );
}
