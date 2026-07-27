"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cctv, LocateFixed, LogOut, Moon, Plus, Sun, TriangleAlert, User } from "lucide-react";
import { AddCameraDrawer } from "@/components/AddCameraDrawer";
import { AuthSheet } from "@/components/AuthSheet";
import { CameraDetailSheet } from "@/components/CameraDetailSheet";
import { UnlockGate } from "@/components/UnlockGate";
import { cx } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/useAuth";
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
const THEME_KEY = "anpr:theme";
/** Remembers that this visitor chose to browse without an account. */
const GUEST_KEY = "anpr:guest";

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

  const auth = useAuth();
  const [guest, setGuest] = useState(false);
  const [gateChecked, setGateChecked] = useState(false);
  const [authSheet, setAuthSheet] = useState<null | {
    mode: "signin" | "register";
    reason?: string;
  }>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** The last bbox the map reported, so an auth change can re-query the same area. */
  const lastBBox = useRef<string | null>(null);

  /* --------------------------------------------------------------- theme -- */
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    setTheme(stored === "light" ? "light" : "dark");
  }, []);

  /* ---------------------------------------------------------------- gate -- */
  useEffect(() => {
    try {
      setGuest(window.localStorage.getItem(GUEST_KEY) === "true");
    } catch {
      /* private mode: the gate reappears next visit, which is harmless */
    }
    setGateChecked(true);
  }, []);

  const continueAsGuest = useCallback(() => {
    setGuest(true);
    try {
      window.localStorage.setItem(GUEST_KEY, "true");
    } catch {
      /* private mode */
    }
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    // Back to the gate rather than straight into a guest session: signing out
    // is a deliberate act, and silently becoming a guest hides that it worked.
    setGuest(false);
    try {
      window.localStorage.removeItem(GUEST_KEY);
    } catch {
      /* private mode */
    }
  }, [auth]);

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
      lastBBox.current = bbox;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void load(bbox), BBOX_DEBOUNCE_MS);
    },
    [load],
  );

  /**
   * canDelete is decided per request by the server, so every camera already in
   * the store carries the *previous* session's answer. Signing in or out
   * invalidates all of it — drop the store and re-query, rather than leaving
   * delete buttons that are missing (or, worse, present and unauthorised).
   */
  const authUserId = auth.user?.id ?? null;
  const previousAuthUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Skip the first run: the initial load has not happened yet.
    if (previousAuthUserId.current === undefined) {
      previousAuthUserId.current = authUserId;
      return;
    }
    if (previousAuthUserId.current === authUserId) return;
    previousAuthUserId.current = authUserId;

    setCameras(new Map());
    if (lastBBox.current) void load(lastBBox.current);
  }, [authUserId, load]);

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

  const handleDeleted = useCallback((id: string) => {
    setCameras((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setVisibleCount((n) => Math.max(0, n - 1));
    setSelectedId(null);
  }, []);

  /** The FAB, but only for someone who can actually complete the flow. */
  const startAdding = useCallback(() => {
    if (!auth.user) {
      setAuthSheet({ mode: "signin", reason: "Adding a camera needs an account." });
      return;
    }
    setSelectedId(null);
    setDrawerOpen(true);
  }, [auth.user]);

  const locateMe = useCallback((options?: { silent?: boolean }) => {
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
      () => {
        // A silent auto-locate failing is not worth an error banner: the user
        // never asked for it, and the map is already showing something useful.
        if (!options?.silent) {
          setFetchError("Could not read your location. Check the site's permissions.");
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  const handleLocateClick = useCallback(() => locateMe(), [locateMe]);

  /* ------------------------------------------------------------- locate -- */
  /**
   * Centre on the user automatically, but only once they have already granted
   * location permission — checked via the Permissions API, which reports the
   * stored decision without prompting.
   *
   * Calling getCurrentPosition unconditionally on mount would fire the browser
   * dialog before the user has done anything, which is the most-denied kind of
   * prompt; and a denial is sticky per origin, so one bad first impression
   * costs the feature permanently. The button remains the way to grant it.
   */
  useEffect(() => {
    if (!("geolocation" in navigator) || !navigator.permissions?.query) return;

    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (!cancelled && result.state === "granted") locateMe({ silent: true });
      })
      .catch(() => {
        /* Safari < 16 has no geolocation descriptor — the button still works */
      });

    return () => {
      cancelled = true;
    };
  }, [locateMe]);

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
              PROJECT ANPR
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
              onClick={handleLocateClick}
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

            {auth.user ? (
              <button
                type="button"
                onClick={() => void signOut()}
                title={
                  auth.user.role === "admin"
                    ? `Signed in as ${auth.user.username} (admin) — sign out`
                    : `Signed in as ${auth.user.username} — sign out`
                }
                aria-label={`Signed in as ${auth.user.username}. Sign out.`}
                className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-graphite transition-colors hover:bg-raised hover:text-ink"
              >
                <User
                  className={cx("size-[18px]", auth.user.role === "admin" && "text-sodium")}
                />
                <span className="hidden max-w-[8rem] truncate text-[0.8125rem] sm:inline">
                  {auth.user.username}
                </span>
                <LogOut className="size-3.5 opacity-70" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthSheet({ mode: "signin" })}
                className="h-9 rounded-lg px-2.5 text-[0.8125rem] font-medium text-graphite transition-colors hover:bg-raised hover:text-ink"
              >
                Sign in
              </button>
            )}
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
          onClick={startAdding}
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
        <CameraDetailSheet
          camera={selected}
          onClose={() => setSelectedId(null)}
          onDeleted={handleDeleted}
        />
      ) : null}

      <AuthSheet
        open={authSheet !== null}
        onClose={() => setAuthSheet(null)}
        initialMode={authSheet?.mode ?? "signin"}
        reason={authSheet?.reason}
        onSignIn={auth.signIn}
        onRegister={auth.register}
      />

      {/* The gate waits for both checks so it cannot flash in front of someone
          who is already signed in, or who chose guest on a previous visit. */}
      {gateChecked && !auth.loading && !auth.user && !guest ? (
        <UnlockGate
          onSignIn={() => setAuthSheet({ mode: "signin" })}
          onRegister={() => setAuthSheet({ mode: "register" })}
          onGuest={continueAsGuest}
        />
      ) : null}
    </main>
  );
}
