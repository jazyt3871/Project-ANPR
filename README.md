# Project ANPR

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
| Postgres | **14+, with PostGIS 3** | On the same machine as the app. Set up by [`db/schema.sql`](db/schema.sql). |

Everything runs on one box and nothing off it: Postgres for the rows, the
server's own disk for the photos, and the site on port 3000. No managed
services, no third-party account, no data leaving the machine. One command on a
fresh Ubuntu server sets all of it up — see
[Self-hosting on a VPS](#self-hosting-on-a-vps).

Two things reach the network **at build time**, which matters in locked-down CI:

- `fonts.googleapis.com` — `next/font/google` downloads and self-hosts the two
  typefaces during `next build`.
- `binaries.prisma.sh` — `prisma generate` fetches the query engine binary.

Both have offline workarounds; see [Building offline](#building-offline).

---

## Quick start

Postgres with PostGIS has to be on the machine (`sudo apt install postgresql
postgresql-16-postgis-3`, or `brew install postgresql postgis`). On a server,
skip all of this and run [`scripts/vps-setup.sh`](scripts/vps-setup.sh), which
does every step below for you — see
[Self-hosting on a VPS](#self-hosting-on-a-vps).

```bash
sudo -u postgres createuser --pwprompt anpr
sudo -u postgres createdb --owner anpr anpr
sudo -u postgres psql -d anpr -c 'create extension postgis'

cp .env.example .env        # set the password you just chose
psql "$DATABASE_URL" -f db/schema.sql

npm install
npx prisma generate         # emits the typed client
npm run db:seed             # optional: eight sample cameras so the map isn't empty
npm run dev
```

Open <http://localhost:3000>. If you seeded, pan to downtown Toronto to see the
markers.

[`db/schema.sql`](db/schema.sql) enables PostGIS, creates the `cameras` table
with its `location` geometry column and spatial index, and creates the
rate-limit table. It is idempotent — re-running it is harmless. Photos are
written to `UPLOAD_DIR` and served by `/api/photos`.

> **Do not run `prisma db push` here.** `db/schema.sql` already created
> everything, and Prisma has no geometry type — so `location` is absent from
> `schema.prisma`, and `db push` drops columns it doesn't recognise. It would
> take the geometry column, its trigger and its spatial index with it. Change
> the SQL file and re-run it instead; Prisma is the query client here, not the
> migration tool.

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
| `npm run db:push` | ⚠️ Drops the `location` geometry column — see the warning above. Edit `db/schema.sql` instead. |
| `npm run db:schema` | Applies `db/schema.sql` to `$DATABASE_URL` |
| `npm run db:seed` | Inserts sample cameras; reads `.env` itself, idempotent, safe to re-run |
| `npm run db:studio` | Prisma Studio, to browse rows |

### Verified state

`npm run typecheck`, `npm run lint`, and `next build` all pass clean on the
pinned versions below. Bundle for the map page: **120 kB** first-load JS.

The self-hosted path has been exercised end to end against a live Postgres 16:
`db/schema.sql` applied, `npm run db:seed` inserted its eight cameras and
wrote their photos to `UPLOAD_DIR`, and `npm start` on port 3000 served the
page, `GET /api/cameras?bbox=...`, and `GET /api/photos/<key>`. The one part
not covered is PostGIS itself — no `postgis` package was reachable in that
environment, so the `create extension`, geometry column and GiST index lines
ran in a stubbed form — they are the standard PostGIS incantations, but they
have not been executed here.

`scripts/vps-setup.sh` passes `bash -n` and its `--check` path, but has not
been run end to end on a fresh VPS.

The build completes with no database reachable, which is what keeps a CI build
from depending on the database. With unset credentials the page still renders
and the API returns `503` with a plain message rather than a stack trace — so a
missing `DATABASE_URL` on a first deploy looks like a broken map, not a crashed
app.

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

Six runtime packages, no incidental ones.

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
| `DATABASE_URL` | — | Postgres connection string, e.g. `postgresql://anpr:...@127.0.0.1:5432/anpr` |
| `UPLOAD_DIR` | `./storage/uploads` | Where photos are written. Must be on persistent storage in production. |
| `MAX_UPLOAD_BYTES` | `8388608` | Rejected above this with `413` |
| `RATE_LIMIT_PER_HOUR` | `20` | Submissions per IP |
| `SUBMITTER_SALT` | `project-anpr` | Salt for the coarse submitter tag |

---

## The database

Postgres with PostGIS. [`db/schema.sql`](db/schema.sql) is the source of truth
for everything Prisma cannot express — the extension, the `location` geometry
column with its sync trigger and GiST index, and the check constraints.
`prisma/schema.prisma` declares the same table with `@map()` so the TypeScript
field names (`lat`, `lng`) stay readable while the columns are `latitude`,
`longitude`.

Positions are stored as plain `latitude`/`longitude` floats **and** as a
`geometry(Point, 4326)`. The bounding-box query in
`src/app/api/cameras/route.ts` uses the scalars, so it needs no PostGIS-aware
SQL and handles the antimeridian. The geometry is there for radius and
nearest-neighbour queries via `$queryRaw` — worked examples are at the bottom of
`db/schema.sql`.

Because the trigger derives `location` from the two scalars, application writes
never touch it.

The rate limiter lives in `rate_limit_hits` rather than in process memory, so a
restart does not hand every submitter a fresh quota.

---

## Storage architecture

Photos are files on the server's disk, under `UPLOAD_DIR` and a strict key
convention: `YYYY/MM/<uuid>.<ext>`. The database stores that key, never a URL,
so the store can move without rewriting a row.

They live **outside** `public/`, so every read goes through
`/api/photos/<key>`, which validates the key against the same pattern before it
reaches the filesystem — the reason a request cannot be turned into a
path-traversal read, and the one place to add moderation or auth later.

Uploads pass through `POST /api/cameras`, which checks size, MIME type and
magic numbers before writing, so a renamed executable cannot be stored as
`image/jpeg`. The browser never writes to storage directly.

`src/lib/storage.ts` puts this behind a two-method `StorageDriver` interface.
There is one implementation, `LocalDriver`. If you ever outgrow one machine, a
second implementation of those two methods is the whole change; `publicUrl()`
returning a real URL is how a driver opts out of streaming through the app.

---

## Self-hosting on a VPS

Everything on one box: Postgres with PostGIS, photos on local disk, and the
site served on port 3000. Nothing external, no managed services.

[`scripts/vps-setup.sh`](scripts/vps-setup.sh) does all of it on a bare Ubuntu
22.04 or 24.04 server.

```bash
git clone <your-fork> /opt/project-anpr && cd /opt/project-anpr

./scripts/vps-setup.sh --check     # what's installed, what's missing; changes nothing

sudo ./scripts/vps-setup.sh        # site on http://<server-ip>:3000
```

What it does, in order — each step skipped if already done, so re-running after
a `git pull` is the redeploy:

1. **Checks dependencies** and installs what's missing: Node (NodeSource 22.x,
   only if the system Node is older than 20), Postgres +
   `postgresql-<ver>-postgis-3`, ufw, git, openssl.
2. **Creates the role, database and extensions** (`anpr`/`anpr`), then applies
   `db/schema.sql`.
3. **Writes `.env`** with the connection string, `UPLOAD_DIR`, a generated
   `SUBMITTER_SALT` and a generated database password — `chmod 600`, owned by
   the service account. On a re-run it rewrites only the two lines it owns and
   reuses the existing password, so hand-edited limits survive.
4. **Creates the `anpr` system user**, `npm ci`, `prisma generate`,
   `next build`.
5. **Installs `project-anpr.service`** — `Restart=always`, `NoNewPrivileges`,
   `ProtectSystem=full`, `ReadWritePaths` limited to the upload directory. It
   binds `0.0.0.0:3000` and is the only public listener.
6. **Configures ufw**: deny incoming by default, then 22 and 3000.

### Ports

| Port | Open to | Why |
| --- | --- | --- |
| 22 | world | SSH. Restrict it to your own address if you can: `ufw allow from <ip> to any port 22`. |
| 3000 | world | The site. `--port <n>` moves it, and the firewall rule follows. |
| 5432 | nobody | Postgres keeps its default `listen_addresses='localhost'` — the app reaches it over the loopback interface, nothing off-box needs it. |
| 80 / 443 | nobody | Only opened with `--nginx`, below. |

### Operating it

```bash
journalctl -u project-anpr -f          # logs
systemctl restart project-anpr         # restart
sudo -u postgres psql anpr             # database
ls /opt/project-anpr/storage/uploads   # photos

cd /opt/project-anpr && git pull && sudo ./scripts/vps-setup.sh   # redeploy
```

Two things worth backing up: the database (`pg_dump anpr`) and `UPLOAD_DIR`.
Losing either alone leaves rows pointing at missing photos, or photos with no
rows.

### If you want a domain and HTTPS

Serving on `http://<ip>:3000` is fine for browsing the map, but **the capture
flow will not work on a phone**: `navigator.geolocation` and
`DeviceOrientationEvent` are unavailable outside a secure context, and a bare
IP over HTTP is not one. When you want that, point a domain's A record at the
server and re-run with nginx in front:

```bash
sudo ./scripts/vps-setup.sh --nginx --domain anpr.example.com --email you@example.com
```

That adds an nginx reverse proxy (with `client_max_body_size` derived from
`MAX_UPLOAD_BYTES`, and `X-Forwarded-For` so the rate limiter still sees real
client addresses), moves the app back to `127.0.0.1`, opens 80/443 instead of
3000, and requests a Let's Encrypt certificate with `certbot --nginx
--redirect`. Renewal is `certbot.timer`.

### Flags

`--port`, `--db-name`, `--db-user`, `--db-password`, `--upload-dir`,
`--node-major`, `--seed`, `--nginx`, `--domain`, `--email`, `--no-firewall`
(if you manage rules elsewhere), `--no-build`, `--check`. `--help` lists them
all.

---

## Other ways to run it

The deployment model is one machine: Postgres, the photos and the app together.
Anything that gives you a persistent filesystem and a Postgres works — a VPS
(above), a Fly.io or Render instance with a volume mounted at `UPLOAD_DIR`, or
Docker. Platforms with read-only or ephemeral filesystems (Vercel, Netlify
functions) do not: photos would vanish between deploys. Supporting one means
writing a second `StorageDriver` in `src/lib/storage.ts` — the interface is two
methods and nothing outside that file would change.

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
docker build -t project-anpr .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://anpr:password@host.docker.internal:5432/anpr" \
  -e SUBMITTER_SALT="$(openssl rand -hex 32)" \
  -v anpr-uploads:/app/storage \
  project-anpr
```

Apply `db/schema.sql` to that database once before first boot.

### Building offline

- **Fonts** — replace the `next/font/google` calls in `src/app/layout.tsx` with
  `next/font/local` and commit the `.woff2` files, or drop the imports entirely:
  the `--font-space-grotesk` and `--font-plex-mono` variables already declare
  system fallbacks in the `@theme` block of `globals.css`.
- **Prisma engine** — point `PRISMA_ENGINES_MIRROR` at an internal mirror, or run
  `prisma generate` on a networked machine and vendor the output.

### Before going live

- [ ] `SUBMITTER_SALT` set to a random value (it defaults to a constant)
- [ ] `db/schema.sql` applied to the production database
- [ ] `UPLOAD_DIR` on persistent storage, and backed up with the database
- [ ] HTTPS terminated — the sensors do not work without it
- [ ] A moderation path exists (see [Not included](#not-included))

`scripts/vps-setup.sh` handles the first three.

---

## Project structure

```
db/
  schema.sql               postgis, cameras, geometry trigger, rate-limit table
prisma/
  schema.prisma            Postgres; Camera + RateLimitHit models
scripts/
  seed.mjs                 Eight sample cameras + an embedded placeholder JPEG
  vps-setup.sh             Ubuntu: deps, Postgres, systemd, nginx, ufw, TLS
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
    storage.ts             Photos on disk, behind a swappable driver interface
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
