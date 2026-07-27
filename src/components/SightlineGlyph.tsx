import {
  CONE_LENGTH,
  CONE_SPREAD_DEG,
  conePath,
  GLYPH_CENTER,
  GLYPH_VIEWBOX,
  polar,
  rayPath,
} from "@/lib/sightline";
import { cardinal } from "@/lib/geo";

/**
 * The map marker, at any size, as a React node. Used in the review step and the
 * detail sheet so the glyph on screen is the glyph on the map.
 *
 * Colours come from classes in globals.css, not from inline attributes.
 *
 * `is360` draws a full ring instead of a cone: a dome or panoramic rig has no
 * single bearing, so `bearing` is ignored and there is nothing for the ray or
 * the rotation to mean.
 */
export function SightlineGlyph({
  bearing,
  size = 76,
  showRing = true,
  is360 = false,
}: {
  bearing: number;
  size?: number;
  showRing?: boolean;
  is360?: boolean;
}) {
  const [nx, ny] = polar(GLYPH_CENTER, GLYPH_CENTER, GLYPH_CENTER - 4, 0);

  return (
    <svg
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
      width={size}
      height={size}
      className="shrink-0"
      role="img"
      aria-label={
        is360 ? "360-degree coverage" : `Looking ${Math.round(bearing)} degrees, ${cardinal(bearing)}`
      }
    >
      {showRing ? (
        <>
          <circle
            className="sl-ring"
            cx={GLYPH_CENTER}
            cy={GLYPH_CENTER}
            r={GLYPH_CENTER - 4}
            strokeWidth="1"
          />
          {/* North index, so the rotation can be read against something.
              Skipped for 360°: there is no rotation to read it against. */}
          {is360 ? null : <circle className="sl-north" cx={nx} cy={ny} r="1.5" />}
        </>
      ) : null}

      {is360 ? (
        <circle
          className="sl-360"
          cx={GLYPH_CENTER}
          cy={GLYPH_CENTER}
          r={CONE_LENGTH}
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
      ) : (
        <g transform={`rotate(${bearing} ${GLYPH_CENTER} ${GLYPH_CENTER})`}>
          <path
            className="sl-cone"
            d={conePath(undefined, undefined, undefined, CONE_SPREAD_DEG)}
          />
          <path
            className="sl-ray"
            d={rayPath()}
            strokeWidth="1"
            strokeDasharray="2 3"
            strokeOpacity="0.9"
          />
        </g>
      )}

      <circle
        className="sl-hub"
        cx={GLYPH_CENTER}
        cy={GLYPH_CENTER}
        r="7.5"
        strokeWidth="2"
      />
      <circle className="sl-core" cx={GLYPH_CENTER} cy={GLYPH_CENTER} r="2.5" />
    </svg>
  );
}
