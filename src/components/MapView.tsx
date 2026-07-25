"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { markerHtml } from "@/lib/sightline";
import type { CameraDTO } from "@/lib/types";

/**
 * Plain Leaflet rather than a React binding. Markers here are rotated SVG
 * glyphs that update on selection, and driving `L.divIcon` directly is both
 * less code and one fewer version to keep in step with React.
 */

export type MapViewProps = {
  cameras: CameraDTO[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBBoxChange: (bbox: string) => void;
  userFix: { lat: number; lng: number; accuracy: number } | null;
  /** When true, a tap on the map reports coordinates instead of clearing selection. */
  pickMode: boolean;
  onPick: (lat: number, lng: number) => void;
  theme: "dark" | "light";
  /** Bumping this recentres the map on the user's fix. */
  recenterToken: number;
};

const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
} as const;

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &middot; &copy; <a href="https://carto.com/attributions">CARTO</a>';

const FALLBACK_VIEW: L.LatLngTuple = [43.6532, -79.3832];
const FALLBACK_ZOOM = 13;

/** Last map centre + zoom, so a return visit opens where you left off. */
const VIEW_KEY = "sightline:view";

type StoredView = { lat: number; lng: number; zoom: number };

function readStoredView(): StoredView | null {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredView>;
    // Anything out of range means a corrupt or hand-edited entry: ignore it
    // rather than handing Leaflet coordinates it will throw on.
    if (
      typeof v.lat !== "number" ||
      typeof v.lng !== "number" ||
      typeof v.zoom !== "number" ||
      !Number.isFinite(v.lat) ||
      !Number.isFinite(v.lng) ||
      Math.abs(v.lat) > 90 ||
      Math.abs(v.lng) > 180 ||
      v.zoom < 1 ||
      v.zoom > 20
    ) {
      return null;
    }
    return { lat: v.lat, lng: v.lng, zoom: v.zoom };
  } catch {
    return null; // private mode, or JSON that isn't ours
  }
}

function writeStoredView(map: L.Map) {
  try {
    const c = map.getCenter();
    window.localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }),
    );
  } catch {
    /* quota or private mode — the view just won't persist */
  }
}

export default function MapView({
  cameras,
  selectedId,
  onSelect,
  onBBoxChange,
  userFix,
  pickMode,
  onPick,
  theme,
  recenterToken,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const fixLayerRef = useRef<L.LayerGroup | null>(null);

  // Callbacks live in refs so the init effect can stay a true mount-once.
  const cb = useRef({ onSelect, onBBoxChange, onPick, pickMode });
  cb.current = { onSelect, onBBoxChange, onPick, pickMode };

  /* ---------------------------------------------------------------- init -- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    // Restored inside the effect, not at module scope: localStorage does not
    // exist during SSR, and reading it here keeps the first paint honest.
    const stored = readStoredView();

    const map = L.map(hostRef.current, {
      center: stored ? [stored.lat, stored.lng] : FALLBACK_VIEW,
      zoom: stored ? stored.zoom : FALLBACK_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    tileRef.current = L.tileLayer(TILES.dark, {
      attribution: ATTRIBUTION,
      maxZoom: 20,
      detectRetina: true,
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    fixLayerRef.current = L.layerGroup().addTo(map);

    const report = () => {
      const b = map.getBounds();
      cb.current.onBBoxChange(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          .map((n) => n.toFixed(6))
          .join(","),
      );
    };

    map.on("moveend zoomend", report);
    map.on("moveend zoomend", () => writeStoredView(map));
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cb.current.pickMode) cb.current.onPick(e.latlng.lat, e.latlng.lng);
      else cb.current.onSelect(null);
    });

    map.whenReady(report);
    mapRef.current = map;

    // Captured now: the ref may point elsewhere by the time cleanup runs.
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  /* --------------------------------------------------------------- tiles -- */
  useEffect(() => {
    tileRef.current?.setUrl(TILES[theme]);
  }, [theme]);

  /* --------------------------------------------------------- pick cursor -- */
  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (container) container.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  /* ------------------------------------------------------------- markers -- */
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;

    const live = markersRef.current;
    const seen = new Set<string>();

    for (const camera of cameras) {
      seen.add(camera.id);
      const selected = camera.id === selectedId;
      const icon = L.divIcon({
        className: "camera-marker",
        html: markerHtml(camera.heading, selected),
        iconSize: [76, 76],
        iconAnchor: [38, 38],
      });

      const existing = live.get(camera.id);
      if (existing) {
        existing.setLatLng([camera.lat, camera.lng]);
        existing.setIcon(icon);
        existing.setZIndexOffset(selected ? 1000 : 0);
        existing.getElement()?.setAttribute("data-selected", String(selected));
        continue;
      }

      const marker = L.marker([camera.lat, camera.lng], {
        icon,
        keyboard: true,
        title: `Camera looking ${Math.round(camera.heading)}°`,
        alt: `Camera looking ${Math.round(camera.heading)} degrees`,
        riseOnHover: true,
      });
      marker.on("click", (e: L.LeafletMouseEvent) => {
        // Without this the map's own click handler fires next and clears the
        // selection we just made.
        L.DomEvent.stopPropagation(e.originalEvent);
        cb.current.onSelect(camera.id);
      });
      marker.addTo(layer);
      marker.getElement()?.setAttribute("data-selected", String(selected));
      live.set(camera.id, marker);
    }

    for (const [id, marker] of live) {
      if (!seen.has(id)) {
        layer.removeLayer(marker);
        live.delete(id);
      }
    }
  }, [cameras, selectedId]);

  /* ------------------------------------------------------------- own fix -- */
  useEffect(() => {
    const layer = fixLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!userFix) return;

    // Accuracy is a radius in metres, so draw it as one — a 40 m fix should
    // look like a 40 m disc, not a fixed-size dot that implies certainty.
    L.circle([userFix.lat, userFix.lng], {
      radius: Math.max(userFix.accuracy, 4),
      className: "user-fix-pulse user-fix-accuracy",
      weight: 1,
      interactive: false,
    }).addTo(layer);

    L.circleMarker([userFix.lat, userFix.lng], {
      radius: 5,
      className: "user-fix-dot",
      weight: 2,
      interactive: false,
    }).addTo(layer);
  }, [userFix]);

  /* ----------------------------------------------------------- recentre -- */
  useEffect(() => {
    if (recenterToken === 0 || !userFix || !mapRef.current) return;
    mapRef.current.flyTo([userFix.lat, userFix.lng], Math.max(mapRef.current.getZoom(), 17), {
      duration: 0.7,
    });
  }, [recenterToken, userFix]);

  /* ------------------------------------------------- pan to selection ---- */
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const camera = cameras.find((c) => c.id === selectedId);
    if (!camera) return;
    const map = mapRef.current;
    const point = map.latLngToContainerPoint([camera.lat, camera.lng]);
    const size = map.getSize();
    // Keep the selected marker clear of the sheet, whichever edge it's on.
    const isNarrow = size.x < 768;
    const target = isNarrow
      ? L.point(size.x / 2, size.y * 0.3)
      : L.point((size.x - 416) / 2, size.y / 2);
    map.panBy(point.subtract(target), { animate: true, duration: 0.4 });
  }, [selectedId, cameras]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      role="application"
      aria-label="Map of submitted camera locations"
    />
  );
}
