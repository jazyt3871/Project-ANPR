/**
 * The sightline glyph.
 *
 * One shape, one definition, three renderers: the Leaflet marker, the compass
 * dial, and the detail sheet's mini-diagram. It is the thing this app actually
 * records — a position and the direction a lens looks — so it is drawn the same
 * everywhere, and locking a bearing shows you the exact glyph that will appear
 * on the map.
 *
 * Geometry convention: the cone points to 0° = up = north, and callers rotate
 * it. Screen y grows downward, so "up" is negative y.
 */

export const CONE_SPREAD_DEG = 62; // full angular width of the throw
export const CONE_LENGTH = 30; // in a 0 0 76 76 viewBox
export const GLYPH_VIEWBOX = 76;
export const GLYPH_CENTER = GLYPH_VIEWBOX / 2;

/** Point on a circle at `deg` clockwise from north. */
export function polar(
  cx: number,
  cy: number,
  radius: number,
  deg: number,
): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [cx + radius * Math.sin(r), cy - radius * Math.cos(r)];
}

/**
 * Wedge path for the cone, apex at (cx, cy), opening toward 0°.
 * Rotate the containing <g> to aim it.
 */
export function conePath(
  cx = GLYPH_CENTER,
  cy = GLYPH_CENTER,
  length = CONE_LENGTH,
  spread = CONE_SPREAD_DEG,
): string {
  const half = spread / 2;
  const [x1, y1] = polar(cx, cy, length, -half);
  const [x2, y2] = polar(cx, cy, length, half);
  // sweep-flag 1 = clockwise, i.e. across the top from the left edge to the right
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${length} ${length} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/** Hairline centre ray that marks the exact bearing inside the cone. */
export function rayPath(
  cx = GLYPH_CENTER,
  cy = GLYPH_CENTER,
  length = CONE_LENGTH,
): string {
  return `M ${cx} ${cy} L ${cx} ${(cy - length).toFixed(2)}`;
}

/**
 * Marker markup for Leaflet's divIcon, which takes an HTML string rather than
 * a React node. Same paths and same classes as the React renderers.
 *
 * `is360` draws a full ring instead of a cone: a dome or panoramic rig has no
 * single bearing to rotate a wedge toward, so there is nothing for `bearing`
 * to mean, and it is ignored.
 */
export function markerHtml(bearing: number, selected: boolean, is360 = false): string {
  if (is360) {
    const ringClass = selected ? "sl-360" : "sl-360-dim";
    return `<svg viewBox="0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}" width="${GLYPH_VIEWBOX}" height="${GLYPH_VIEWBOX}" aria-hidden="true">
  <circle class="${ringClass}" cx="${GLYPH_CENTER}" cy="${GLYPH_CENTER}" r="${CONE_LENGTH}" stroke-width="1.5" stroke-dasharray="3 4" />
  <circle class="sl-hub" cx="${GLYPH_CENTER}" cy="${GLYPH_CENTER}" r="7.5" stroke-width="2" opacity="${selected ? 1 : 0.92}" />
  <circle class="sl-core" cx="${GLYPH_CENTER}" cy="${GLYPH_CENTER}" r="2.5" />
</svg>`;
  }

  const coneClass = selected ? "sl-cone" : "sl-cone-dim";

  return `<svg viewBox="0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}" width="${GLYPH_VIEWBOX}" height="${GLYPH_VIEWBOX}" aria-hidden="true">
  <g transform="rotate(${bearing.toFixed(1)} ${GLYPH_CENTER} ${GLYPH_CENTER})">
    <path class="${coneClass}" d="${conePath()}" />
    <path class="sl-ray" d="${rayPath()}" stroke-width="1" stroke-opacity="${selected ? 0.9 : 0.45}" stroke-dasharray="2 3" />
  </g>
  <circle class="sl-hub" cx="${GLYPH_CENTER}" cy="${GLYPH_CENTER}" r="7.5" stroke-width="2" opacity="${selected ? 1 : 0.92}" />
  <circle class="sl-core" cx="${GLYPH_CENTER}" cy="${GLYPH_CENTER}" r="2.5" />
</svg>`;
}
