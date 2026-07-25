import {
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
 */
export function SightlineGlyph({
  bearing,
  size = 76,
  showRing = true,
}: {
  bearing: number;
  size?: number;
  showRing?: boolean;
}) {
  const [nx, ny] = polar(GLYPH_CENTER, GLYPH_CENTER, GLYPH_CENTER - 4, 0);

  return (
    <svg
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
      width={size}
      height={size}
      className="shrink-0"
      role="img"
      aria-label={`Looking ${Math.round(bearing)} degrees, ${cardinal(bearing)}`}
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
          {/* North index, so the rotation can be read against something. */}
          <circle className="sl-north" cx={nx} cy={ny} r="1.5" />
        </>
      ) : null}

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
