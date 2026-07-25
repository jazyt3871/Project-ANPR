"use client";

import { useCallback, useRef } from "react";
import { CONE_SPREAD_DEG, conePath, polar, rayPath } from "@/lib/sightline";
import { cardinal, normalizeBearing } from "@/lib/geo";

/**
 * An azimuth card that rotates under a fixed sightline — the same arrangement
 * as a lubber line on a real compass, and the same cone that will land on the
 * map. What you see here is what gets saved.
 *
 * In manual mode the card is a slider: drag it, or focus it and use the arrow
 * keys. That path exists because desktop browsers have no magnetometer, plenty
 * of phones ship an uncalibrated one, and iOS lets people decline the prompt.
 */

const SIZE = 260;
const C = SIZE / 2;
const RING_R = 116;
const CONE_LEN = 100;

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);
const CARDINAL_LABELS: Array<[number, string]> = [
  [0, "N"],
  [90, "E"],
  [180, "S"],
  [270, "W"],
];

export type CompassDialProps = {
  bearing: number | null;
  /** Present the card as adjustable and wire up drag + keys. */
  interactive: boolean;
  onChange?: (bearing: number) => void;
  /** Dim the whole dial while there is no reading to show. */
  idle?: boolean;
  /** The sensor's own reported error in degrees, when it offers one. */
  sensorAccuracy?: number | null;
};

export function CompassDial({
  bearing,
  interactive,
  onChange,
  idle = false,
  sensorAccuracy = null,
}: CompassDialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);

  const shown = bearing ?? 0;

  const bearingFromPointer = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // Dead zone at the hub, where the angle is mostly noise.
    if (Math.hypot(dx, dy) < rect.width * 0.08) return null;
    return normalizeBearing((Math.atan2(dx, -dy) * 180) / Math.PI);
  }, []);

  const handlePointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || !onChange) return;
      const next = bearingFromPointer(e.clientX, e.clientY);
      if (next !== null) onChange(next);
    },
    [interactive, onChange, bearingFromPointer],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [interactive, handlePointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging.current) return;
      e.preventDefault();
      handlePointer(e);
    },
    [handlePointer],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (!interactive || !onChange) return;
      if (e.key === "Home") {
        e.preventDefault();
        onChange(0);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const deltas: Record<string, number> = {
        ArrowRight: step,
        ArrowUp: step,
        ArrowLeft: -step,
        ArrowDown: -step,
      };
      const delta = deltas[e.key];
      if (delta === undefined) return;
      e.preventDefault();
      onChange(normalizeBearing(shown + delta));
    },
    [interactive, onChange, shown],
  );

  return (
    <div className="flex flex-col items-center select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[260px]"
        style={{
          touchAction: "none",
          opacity: idle ? 0.4 : 1,
          cursor: interactive ? "grab" : "default",
        }}
        role={interactive ? "slider" : "img"}
        tabIndex={interactive ? 0 : -1}
        aria-label={interactive ? "Camera bearing" : "Live compass bearing"}
        aria-valuenow={interactive ? Math.round(shown) : undefined}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? 359 : undefined}
        aria-valuetext={
          bearing === null
            ? "No bearing yet"
            : `${Math.round(shown)} degrees, ${cardinal(shown)}`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {/* The card: everything fixed to the world rotates. */}
        <g transform={`rotate(${-shown} ${C} ${C})`}>
          <circle className="dial-face" cx={C} cy={C} r={RING_R} strokeWidth="1" />

          {TICKS.map((deg) => {
            const major = deg % 90 === 0;
            const medium = deg % 30 === 0;
            const inner = RING_R - (major ? 16 : medium ? 11 : 6);
            const [x1, y1] = polar(C, C, RING_R - 1, deg);
            const [x2, y2] = polar(C, C, inner, deg);
            return (
              <line
                key={deg}
                className={major ? "dial-tick-major" : "dial-tick"}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={major ? 1.75 : 1}
                strokeOpacity={major ? 0.85 : medium ? 0.55 : 0.3}
              />
            );
          })}

          {CARDINAL_LABELS.map(([deg, label]) => {
            const [x, y] = polar(C, C, RING_R - 33, deg);
            return (
              <text
                key={label}
                className={deg === 0 ? "dial-label-north" : "dial-label"}
                x={x}
                y={y}
                // Counter-rotated so the letters stay upright as the card turns.
                transform={`rotate(${shown} ${x} ${y})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="14"
                fontWeight={deg === 0 ? 600 : 400}
              >
                {label}
              </text>
            );
          })}
        </g>

        {/* The sightline: fixed, because it is the phone, not the world. */}
        <g opacity={bearing === null ? 0.25 : 1}>
          <path className="sl-cone" d={conePath(C, C, CONE_LEN, CONE_SPREAD_DEG)} />
          <path
            className="sl-ray"
            d={rayPath(C, C, CONE_LEN)}
            strokeWidth="1.25"
            strokeDasharray="3 4"
            strokeOpacity="0.8"
          />
          {/* Index mark at the rim, where the bearing is read off. */}
          <path className="dial-index" d={`M ${C} 6 L ${C - 6} 18 L ${C + 6} 18 Z`} />
        </g>

        {/* Sensor error, drawn to scale either side of the ray. */}
        {sensorAccuracy != null && sensorAccuracy > 0 && bearing !== null ? (
          <path
            className="dial-error"
            d={conePath(C, C, CONE_LEN + 8, Math.min(sensorAccuracy * 2, 120))}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="2 3"
          />
        ) : null}

        {/* Readout sits in the lower half, clear of the cone. */}
        <text
          className="dial-value"
          x={C}
          y={C + 48}
          textAnchor="middle"
          fontSize="42"
          fontWeight="500"
        >
          {bearing === null ? "—" : `${Math.round(shown)}°`}
        </text>
        <text className="dial-caption" x={C} y={C + 70} textAnchor="middle" fontSize="11">
          {bearing === null ? "NO BEARING" : cardinal(shown).toUpperCase()}
        </text>

        <circle className="sl-hub" cx={C} cy={C} r="5" strokeWidth="2" />
      </svg>

      {interactive ? (
        <p className="mt-1 text-center text-[0.75rem] text-graphite">
          Drag the dial, or use the arrow keys.
        </p>
      ) : null}
    </div>
  );
}
