/**
 * The cone is this app's one signature shape, and it has to look identical in
 * three places: the map marker, the compass dial, and the detail sheet. Two of
 * those are React SVG and one is a raw HTML string handed to Leaflet, so the
 * gradients live once in the document and everything references them by id.
 *
 * Stop colours are set in globals.css (`#sightline-cone stop`) so they follow
 * the theme. Only the opacity ramp is declared here.
 */
export function SightlineDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        {/* Dense at the lens, gone by the far edge of the throw. */}
        <radialGradient id="sightline-cone" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopOpacity="0.78" />
          <stop offset="45%" stopOpacity="0.3" />
          <stop offset="100%" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="sightline-cone-dim" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopOpacity="0.42" />
          <stop offset="45%" stopOpacity="0.16" />
          <stop offset="100%" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="fix-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopOpacity="0.32" />
          <stop offset="100%" stopOpacity="0.04" />
        </radialGradient>

        {/* For 360°/panoramic cameras: centered rather than anchored at the
            apex like the cone gradients above, since there is no single lens
            direction to be dense toward — the coverage is the whole ring. */}
        <radialGradient id="sightline-360" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopOpacity="0.5" />
          <stop offset="70%" stopOpacity="0.16" />
          <stop offset="100%" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="sightline-360-dim" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopOpacity="0.28" />
          <stop offset="70%" stopOpacity="0.09" />
          <stop offset="100%" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
