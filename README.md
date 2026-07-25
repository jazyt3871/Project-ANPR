# Sightline

A crowdsourced map of camera locations. Each submission is three things measured
from the street: a GPS fix, the bearing the lens looks along, and a photo.

Mobile-first, dark by default, no account required.

---

## Requirements

| Need | Version | Notes |
| --- | --- | --- |
| **Node.js** | **20.9+ or 22+** | Next.js 15 dropped Node 18. Check with `node -v`. |
| npm | 10+ | Ships with Node. pnpm and yarn both work. |
| A phone | iOS 13+ / Android 8+ | The GPS and compass steps cannot be exercised on a desktop — see [Testing the sensors](#testing-the-sensors). |
| A Supabase project | Free tier | Postgres + PostGIS for the rows, Storage for the photos. Create one at [supabase.com](https://supabase.com). |

No Docker and no local database server: Supabase provides both, and the whole
setup is one SQL script plus four environment variables.

Two things reach the network **at build time**, which matters in locked-down CI:

- `fonts.googleapis.com` — `next/font/google` downloads and self-hosts the two
  typefaces during `next build`.
- `binaries.prisma.sh` — `prisma generate` fetches the query engine binary.

Both have offline workarounds; see [Building offline](#building-offline).

---

## Quick start

**1. Set up the database.** In the Supabase dashboard, open the **SQL Editor**,
paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and
press **Run**. That single script enables PostGIS, creates the `cameras` table
with its `location` geometry column and spatial index, creates the rate-limit
table, and creates the public `camera-photos` bucket with its RLS policies. It
is idempotent — re-running it is harmless.

**2. Wire up the app.**

```bash
cp .env.example .env        # then fill in the four Supabase values
npm install                 # ~380 packages
npx prisma generate         # emits the typed client
npm run db:seed             # optional: eight sample cameras so the map isn't empty
npm run dev
```

The four values come from the Supabase dashboard:

| Variable | Where to find it |
| --- | --- |
| `DATABASE_URL` | Project Settings → Database → Connection string → **Transaction pooler** (port 6543) |
| `DIRECT_URL` | Same page, **Direct connection** (port 5432) |
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` secret |

Open <http://localhost:3000>. If you seeded, pan to downtown Toronto to see the
markers.

> **Do not run `prisma db push` here.** `supabase/schema.sql` already created
> everything, and Prisma has no geometry type — so `location` is absent from
> `schema.prisma`, and `db push` drops columns it doesn't recognise. It would
> take the geometry column, its trigger and its spatial index with it. Change
> the SQL file and re-run it in the SQL Editor instead; Prisma is the query
> client here, not the migration tool.

For a production run on the same machine:

```bash
npm run build               # runs prisma generate, then next build
npm start                   # serves on :3000
```

### Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on `localhost:3000` |
| `npm run dev:https` | Dev server over HTTPS on `0.0.0.0` — **required for phone testing** |
| `npm run build` | `prisma generate` then a production build |
| `npm start` | Serves the production build |
| `npm run lint` | ESLint (flat config, `next/core-web-vitals` + `next/typescript`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | ⚠️ Drops the `location` geometry column — see the warning above. Edit `supabase/schema.sql` instead. |
| `npm run db:seed` | Inserts sample cameras; idempotent, safe to re-run |
| `npm run db:studio` | Prisma Studio, to browse rows |

### Verified state

`npm run typecheck`, `npm run lint`, and `next build` all pass clean on the
pinned versions below. Bundle for the map page: **119 kB** first-load JS.

The build completes with no database reachable, which is what keeps Vercel's
build step from depending on Supabase. With unset credentials the page still
renders and the API returns `503` with a plain message rather than a stack
trace — so a missing `DATABASE_URL` on a first deploy looks like a broken map,
not a crashed app.

`supabase/schema.sql` has **not** been executed against a live Postgres in this
repo's checks — verify it by running it once in a scratch Supabase project
before pointing production at it.

---

## Testing the sensors

**This is the part that catches people out.** `navigator.geolocation` and
`DeviceOrientationEvent` both require a secure context. `localhost` counts, but
`http://192.168.x.x` does not — so a phone on your LAN pointed at a plain dev
server will silently get no GPS and no compass.

```bash
npm run dev:https           # next dev --experimental-https --hostname 0.0.0.0
```

Next mints a local certificate; browse to `https://<your-lan-ip>:3000` on the
phone and accept the warning. On iOS you must also be on HTTPS for the
`DeviceOrientationEvent.requestPermission()` prompt to appear at all.

On a desktop browser there is no magnetometer. Step 2 detects this and hands you
a draggable dial instead, so the whole flow is still exercisable from a laptop.

---

## Dependencies

Seven runtime packages, no incidental ones.

| Package | Version | What it is for |
| --- | --- | --- |
| `next` | 15.5.21 | App Router, Route Handlers for the API, `next/font` for self-hosted type |
| `react` / `react-dom` | 19.2.8 | Required by Next 15 |
| `leaflet` | 1.9.4 | The map, driven directly — see below |
| `lucide-react` | 0.577.0 | Icons |
| `@prisma/client` | 6.19.3 | Database access |
| `zod` | 3.25.76 | Validates the multipart submission server-side |

Dev-only:

| Package | Version | For |
| --- | --- | --- |
| `typescript` | 5.9.3 | |
| `prisma` | 6.19.3 | CLI: `generate`, `db push`, `studio` |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | Tailwind v4 — configured in CSS, there is no `tailwind.config.js` |
| `eslint`, `eslint-config-next`, `@eslint/eslintrc` | 9.39.5 / 15.5.21 / 3.3.6 | Flat config bridges the eslintrc-authored Next preset |
| `@types/leaflet`, `@types/node`, `@types/react`, `@types/react-dom` | — | |

Optional:

| Package | When |
| --- | --- |
| `@supabase/supabase-js` 2.48.1 | Photo storage. Imported dynamically inside the driver, so it stays out of the bundle when `STORAGE_DRIVER=local`. |

**Why no `react-leaflet`.** Markers here are rotated SVG glyphs whose fill
changes on selection, which means driving `L.divIcon` directly. Going through a
React binding would be more code, not less, and would add a package whose major
version has to stay in step with both React and Leaflet.
`src/components/MapView.tsx` is a thin `useEffect` wrapper instead.

---

## How the capture flow works

| Step | What happens | Fallback when it fails |
| --- | --- | --- |
| 1. Location | `watchPosition` at `enableHighAccuracy`, keeping the **tightest** reading while a meter shows it converging | Tap the map to place the pin; stored with no accuracy value |
| 2. Bearing | Live compass under a fixed sightline, smoothed by circular mean | Drag the dial, or arrow-key it; recorded as `headingSource: "manual"` |
| 3. Photo | `<input capture="environment">`, then downscaled and re-encoded in-browser | Plain file picker |
| 4. Save | One `multipart/form-data` POST | Errors state what happened and what to do |

### The compass, specifically

Two entirely different APIs hide behind "read the heading":

- **iOS Safari** puts `webkitCompassHeading` on the event — already a true-north
  bearing, clockwise. Used directly.
- **Chromium** fires `deviceorientationabsolute` with `alpha`, which rotates
  *counter*-clockwise from north, so it is inverted (`360 - alpha`) and then
  corrected for `screen.orientation.angle`.

Readings are averaged as unit vectors rather than numbers, because a plain mean
is wrong across the 0/360 seam — 359° and 1° average to 180°, pointing the cone
exactly backwards.

The UI surfaces three failure modes that are usually swallowed: permission
declined, permission granted but no events arriving within 3.5 s, and
`event.absolute === false` (a reading relative to where the device started, not
to north — a real number that is not a real bearing).

### Photo handling

Photos are re-encoded through a canvas client-side. That downscales a 12 MP
phone shot to roughly 300 KB, and drops every EXIF tag in the process —
including the camera's own GPS record. **The only position ever stored is the
one the submitter explicitly confirmed.** `createImageBitmap(file, {
imageOrientation: "from-image" })` applies the orientation flag first so portrait
shots don't land sideways.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Supabase **pooled** connection string (port 6543) |
| `DIRECT_URL` | — | Supabase **direct** connection (port 5432); migrations only |
| `SUPABASE_URL` | — | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only. Bypasses RLS; never expose it |
| `SUPABASE_BUCKET` | `camera-photos` | Bucket created by `supabase/schema.sql` |
| `SUPABASE_BUCKET_PUBLIC` | `true` | `false` streams photos through `/api/photos` instead of the CDN |
| `STORAGE_DRIVER` | inferred | `supabase` when `SUPABASE_URL` is set, else `local` |
| `UPLOAD_DIR` | `./storage/uploads` | Where the `local` driver writes (dev only) |
| `MAX_UPLOAD_BYTES` | `8388608` | Rejected above this with `413` |
| `RATE_LIMIT_PER_HOUR` | `20` | Submissions per IP |
| `SUBMITTER_SALT` | `sightline` | Salt for the coarse submitter tag |

---

## The database

Supabase Postgres with PostGIS. [`supabase/schema.sql`](supabase/schema.sql) is
the source of truth for everything Prisma cannot express — the extension, the
`location` geometry column with its sync trigger and GiST index, the check
constraints, RLS, and the storage bucket policies.
`prisma/schema.prisma` declares the same table with `@map()` so the TypeScript
field names (`lat`, `lng`) stay readable while the columns are `latitude`,
`longitude`.

Positions are stored as plain `latitude`/`longitude` floats **and** as a
`geometry(Point, 4326)`. The bounding-box query in
`src/app/api/cameras/route.ts` uses the scalars, so it needs no PostGIS-aware
SQL and handles the antimeridian. The geometry is there for radius and
nearest-neighbour queries via `$queryRaw` — worked examples are at the bottom of
`supabase/schema.sql`.

Because the trigger derives `location` from the two scalars, application writes
never touch it.

---

## Storage architecture

Photos go to the `camera-photos` bucket under a strict key convention,
`YYYY/MM/<uuid>.<ext>`. The bucket is public, so `<img src>` resolves straight
to the Supabase CDN with no round-trip through the app.

Uploads never go **directly** from the browser to Supabase. They pass through
`POST /api/cameras`, which uses the service-role key after checking size, MIME
type, and magic numbers — so a renamed executable cannot be stored as
`image/jpeg`, and there is no public insert policy for a script to abuse. The
RLS policies in `supabase/schema.sql` grant the anon key `select` only.

If you make the bucket private later, set `SUPABASE_BUCKET_PUBLIC=false`: reads
then stream through `/api/photos/<key>`, which validates the key against the
same pattern before fetching. No rows need rewriting, because the column stores
the object key rather than a URL.

---

## Deploying

### 1. Run the SQL

Supabase dashboard → **SQL Editor** → paste all of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**. One click, idempotent.

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "Sightline"
gh repo create sightline --private --source=. --push
# or: git remote add origin git@github.com:<you>/sightline.git && git push -u origin main
```

`.env` is gitignored — confirm with `git status` that it is not staged before
the first push.

### 3. Import in Vercel

[vercel.com/new](https://vercel.com/new) → import the repository. The framework
preset, build command, and output directory are all detected; nothing needs
changing. Under **Environment Variables**, add the four from your `.env`:

```
DATABASE_URL                 (the pooled string, port 6543)
DIRECT_URL                   (the direct string, port 5432)
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Then **Deploy**.

Three details that are already handled, listed so they don't surprise you later:

- **`prisma generate` runs in `npm run build`.** Vercel caches `node_modules`
  between builds, so a project relying on the `postinstall` hook alone ships a
  stale client. This one does not.
- **The pooled connection string is not optional.** Each serverless invocation
  opens its own connection; direct connections to port 5432 exhaust Postgres'
  limit under any real traffic.
- **The rate limiter is in Postgres, not memory** (`rate_limit_hits`). On Vercel
  each request may hit a different instance, so an in-process counter would let
  a submitter multiply their quota by the number of warm lambdas.

Vercel caps request bodies at 4.5 MB against the 8 MB `MAX_UPLOAD_BYTES` here.
In practice the client downscales every photo to 1600 px (~300 KB) before it is
sent, so the cap is not reached — but lower `MAX_UPLOAD_BYTES` to `4194304` if
you ever remove that step.

### Other hosts

| Host | Storage driver | Notes |
| --- | --- | --- |
| Vercel / Netlify | `supabase` | Read-only filesystem; the `local` driver throws at boot on Vercel rather than failing at the first upload. |
| Fly.io / Railway / Render | either | For `local`, attach a persistent volume and point `UPLOAD_DIR` at it. |
| VPS with Docker | either | Mount a volume for `storage/`. |

### Docker

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
# openssl is required by the Prisma query engine
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# next/font and prisma both reach the network during this step
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t sightline .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e SUBMITTER_SALT="$(openssl rand -hex 32)" \
  -v sightline-uploads:/app/storage \
  sightline
```

Run `npx prisma db push` once against the production database before first boot.

### Building offline

- **Fonts** — replace the `next/font/google` calls in `src/app/layout.tsx` with
  `next/font/local` and commit the `.woff2` files, or drop the imports entirely:
  the `--font-space-grotesk` and `--font-plex-mono` variables already declare
  system fallbacks in the `@theme` block of `globals.css`.
- **Prisma engine** — point `PRISMA_ENGINES_MIRROR` at an internal mirror, or run
  `prisma generate` on a networked machine and vendor the output.

### Before going live

- [ ] `DATABASE_URL` points at a pooled Postgres connection
- [ ] `SUBMITTER_SALT` set to a random value (it defaults to a constant)
- [ ] `STORAGE_DRIVER` matches what the host's filesystem can actually do
- [ ] `npx prisma db push` run against the production database
- [ ] Rate limiter moved to shared storage
- [ ] HTTPS terminated — the sensors do not work without it
- [ ] A moderation path exists (see [Not included](#not-included))

---

## Project structure

```
supabase/
  schema.sql               One-click setup: postgis, cameras, bucket, RLS
prisma/
  schema.prisma            Postgres; Camera + RateLimitHit models
scripts/
  seed.mjs                 Eight sample cameras + an embedded placeholder JPEG
src/
  app/
    layout.tsx             Fonts, theme-before-paint script, shared SVG defs
    page.tsx               The map is the page
    globals.css            Design tokens, theme flip, Leaflet skin, glyph classes
    api/
      README.md            Full endpoint + field reference
      cameras/route.ts     GET (bbox) + POST (multipart)
      cameras/[id]/route.ts
      photos/[...key]/route.ts
  components/
    CameraMapApp.tsx       Shell: instrument strip, FAB, fetching, state
    MapView.tsx            Leaflet, rotated markers, accuracy disc, pin-drop
    AddCameraDrawer.tsx    Four-step flow orchestration
    CompassDial.tsx        Azimuth card under a fixed sightline
    CameraDetailSheet.tsx  Photo, bearing, coordinates, OSM link
    SightlineGlyph.tsx     The marker, as a React node
    SightlineDefs.tsx      Gradients, defined once for the whole document
    steps/                 One file per capture step
    ui/primitives.tsx      Button, Sheet, FieldRow, Notice
  hooks/
    useGeolocation.ts      Converging high-accuracy fix
    useDeviceHeading.ts    Cross-platform compass + manual fallback
  lib/
    sightline.ts           The cone geometry — one definition, three renderers
    geo.ts                 Bearings, bbox parsing, circular mean, distance
    image.ts               Client-side downscale + EXIF strip
    storage.ts             Pluggable photo storage
    validation.ts          Zod schemas
    rate-limit.ts          Sliding window
    serialize.ts           Row → DTO, minus the submitter hash
    db.ts                  Prisma singleton
```

---

## Design notes

The map is the page; everything else floats over it. One accent colour, borrowed
from sodium-vapour street lighting. Space Grotesk carries the voice, IBM Plex
Mono carries every measured value — the rule is strict, and it means a number
being set in mono tells you it came off a sensor.

The signature is the **sightline cone**. `lib/sightline.ts` holds one geometry
function, and the Leaflet marker, the compass dial, and the review screen all
render from it. Locking a bearing shows you the exact mark that will appear on
the map.

Colours for SVG live in CSS classes rather than presentation attributes: `var()`
inside an attribute value is inconsistently supported, whereas a CSS rule always
beats a presentation attribute. That is also what lets Leaflet's vectors follow
the theme, since Leaflet writes `stroke`/`fill` as attributes from its options.

---

## Version pinning

Versions are pinned exactly, and chosen rather than defaulted:

| Package | Pinned | Latest | Why |
| --- | --- | --- | --- |
| `next` | 15.5.21 | 16.2.11 | 15.5.21 patches CVE-2025-66478. Moving to 16 is a real migration, not a bump |
| `prisma` | 6.19.3 | 7.x | Prisma 7 changed the generator and client import path |
| `zod` | 3.25.76 | 4.x | Zod 4 has breaking schema-API changes |
| `lucide-react` | 0.577.0 | 1.x | Major version, unverified icon renames |
| `react` | 19.2.8 | 19.2.8 | current |
| `tailwindcss` | 4.3.3 | 4.3.3 | current |

Do not upgrade the first four casually — each needs its own migration pass.

---

## Not included

Deliberate omissions, so you know what you'd be building next:

- **Moderation.** Anyone can post anything. Add a `status` column and filter
  `GET /api/cameras` on it before this faces the public.
- **Clustering.** Above a few thousand markers in view, add
  `leaflet.markercluster` or switch the `GET` to a tile/aggregate endpoint.
- **Editing and deletion.** No `PATCH` or `DELETE` — mapping mistakes are
  currently permanent.
- **Duplicate detection.** `distanceMetres` and `bearingDelta` in `lib/geo.ts`
  are already there for a "camera already mapped within 15 m on a similar
  bearing?" check.

## Known caveats

- The `screen.orientation.angle` correction in the Chromium bearing path is
  right in portrait, which is how this gets used, but I have not verified it in
  landscape. It is commented at the call site in
  `src/hooks/useDeviceHeading.ts`. The manual dial is always available as a
  correction path.
- Phone magnetometers are frequently uncalibrated and are thrown off by cars,
  railings, and phone cases with magnets. Where the sensor reports its own error
  (`webkitCompassAccuracy`), it is drawn on the dial and warned about above 15°.
- `next/font/google` fetches at build time, so builds need network access to
  `fonts.googleapis.com`. Swap to `next/font/local` with the files vendored if
  you need fully offline builds.
