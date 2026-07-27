# Project ANPR

A crowdsourced map of camera locations. Each submission is three things measured
from the street: a GPS fix, the bearing the lens looks along, and a photo.

Mobile-first, dark by default. Browsing needs no account; contributing does.

---

## Requirements

| Need | Version | Notes |
| --- | --- | --- |
| **Node.js** | **20.9+ or 22+** | Next.js 15 dropped Node 18. Check with `node -v`. |
| npm | 10+ | Ships with Node. pnpm and yarn both work. |
| A phone | iOS 13+ / Android 8+ | The GPS and compass steps cannot be exercised on a desktop — see [Testing the sensors](#testing-the-sensors). |
| Postgres | **14+** | On the same machine as the app. Set up by [`db/schema.sql`](db/schema.sql). PostGIS is used if present but not required — see [The database](#the-database). |

Everything runs on one box and nothing off it: Postgres for the rows, the
server's own disk for the photos, and the site on port 3000. No managed
services, no third-party account, no data leaving the machine. One command
sets all of it up, on [an Ubuntu server](#self-hosting-on-a-vps) or on
[a Windows PC](#running-it-from-a-windows-pc). There is also a free
[Fly.io](#deploying-to-flyio-free-tier) path.

Two things reach the network **at build time**, which matters in locked-down CI:

- `fonts.googleapis.com` — `next/font/google` downloads and self-hosts the two
  typefaces during `next build`.
- `binaries.prisma.sh` — `prisma generate` fetches the query engine binary.

Both have offline workarounds; see [Building offline](#building-offline).

---

## Quick start

Postgres has to be on the machine (`sudo apt install postgresql
postgresql-16-postgis-3`, or `brew install postgresql postgis` — the postgis
package is optional, see below). Rather than doing any of this by hand, there
is a one-command setup for [Ubuntu](#self-hosting-on-a-vps) and for
[Windows](#running-it-from-a-windows-pc).

```bash
sudo -u postgres createuser --pwprompt anpr
sudo -u postgres createdb --owner anpr anpr
sudo -u postgres psql -d anpr -c 'create extension postgis'   # optional

cp .env.example .env        # set the password you just chose
psql "$DATABASE_URL" -f db/schema.sql

npm install
npx prisma generate         # emits the typed client
npm run db:seed             # optional: eight sample cameras so the map isn't empty
npm run dev
```

Open <http://localhost:3000>. If you seeded, pan to downtown Toronto to see the
markers.

[`db/schema.sql`](db/schema.sql) creates the `cameras` table, the rate-limit
table, and — where PostGIS is available — the `location` geometry column with
its trigger and spatial index. It is idempotent, and re-running it on a
database that has since gained PostGIS adds the geometry parts to the existing
table. Photos are written to `UPLOAD_DIR` and served by `/api/photos`.

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
| `npm run admin` | Creates the `anpr` admin and prints a generated password. `-- --reset-password` rotates it |
| `npm run db:studio` | Prisma Studio, to browse rows |

### Verified state

`npm run typecheck`, `npm run lint`, and `next build` all pass clean on the
pinned versions below. Bundle for the map page: **120 kB** first-load JS.

The self-hosted path has been exercised end to end against a live Postgres 16:
`db/schema.sql` applied, `npm run db:seed` inserted its eight cameras and
wrote their photos to `UPLOAD_DIR`, and `npm start` on port 3000 served the
page, `GET /api/cameras?bbox=...`, and `GET /api/photos/<key>`. That run was on a Postgres **without** PostGIS, which is now a supported
configuration rather than a stub: the schema's detection block skipped the
geometry column, the seed and the full upload/read round trip worked anyway,
and re-applying the schema was clean. The PostGIS branch of that block —
the extension, geometry column, trigger and GiST index — is unchanged from
what shipped before, but no `postgis` package was reachable here, so it
remains unexecuted in these checks.

`scripts/install-linux.sh` passes `bash -n` and its `--check` path, and
`scripts/start-linux.sh` was run end to end against a live build and database
— production mode, dev mode, and its two guard rails (missing `.env`, missing
build) all behave as documented. Neither has been exercised on a fresh VPS.
`scripts/install-windows.ps1` and `scripts/start-windows.ps1` have been
reviewed but not executed — no PowerShell or Windows machine was available in
these checks.

Accounts and deletion were exercised end to end against that same live
Postgres, through the API and through a real browser (Chromium via Playwright):
registering, signing in, and signing out; a guest being refused `POST` (401)
and `DELETE` (401); one user being refused deletion of another's camera (403)
while the owner and the admin both succeed (200), with the photo file removed
from disk alongside the row; wrong-password and unknown-username both
answering 401; logout deleting the session row rather than only the cookie;
and `/api/geo` returning the right box for a Cloudflare/Vercel country header,
the world for an absent, anonymised (`XX`) or unrecognised code. In the browser:
the gate appearing for a new visitor and dismissing on "continue as a guest",
the FAB prompting for an account as a guest and opening the capture flow once
signed in, and an owner deleting their own camera through the confirm step with
the marker disappearing from the map.

Two bugs that only the browser pass caught, both now fixed: the sign-in sheet
opened on the wrong tab after the first time (`useState(initialMode)` never
re-read the prop on a component that stays mounted), and the gate's overlay sat
above the sheet and swallowed every click meant for the form — making
registration impossible from the gate.

The `next build`'s standalone output (what `Dockerfile` and Fly ship) has been
run directly — `node .next/standalone/server.js` against the same live
Postgres, with the same schema, uploading through `POST /api/cameras` and
reading it back through `GET /api/photos/<key>` — so the server Fly actually
runs is verified. What isn't: no Docker daemon was reachable here, so
`docker build` / `fly deploy` themselves are unexercised, and
`scripts/fly-db-setup.sh` — no Fly account was available to run it against.

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
| `INSECURE_COOKIES` | unset | Set `true` only to keep session cookies working over plain HTTP in production — see [Accounts](#accounts) |

---

## Accounts

Reading the map needs no account. Adding a camera does, and so does removing
one.

A first-time visitor gets a gate with three options — create an account, sign
in, or **continue as a guest**. Guest is a real choice, not fine print: the map
is public information, and putting a wall in front of it would be dishonest
about what this is. The account buys the ability to contribute, and that is
what the copy promises.

| Who | Can view | Can add | Can delete |
| --- | --- | --- | --- |
| Guest | yes | no | no |
| Signed in | yes | yes | their own submissions |
| `anpr` (admin) | yes | yes | anything |

The admin account is created by the installers, or by hand:

```bash
npm run admin                        # creates "anpr", prints a generated password
npm run admin -- --reset-password    # rotate it
npm run admin -- --username someone  # promote/create a different admin
```

The password is a six-word passphrase plus digits — long enough to resist
guessing, and possible to retype on a phone, which a random character string
is not. It is printed **once** and stored only as a hash. Re-running the
installer does not rotate it, so a redeploy never invalidates the credentials
you wrote down.

### How it works

- **Passwords** are scrypt hashes (`node:crypto`). Not bcrypt or argon2:
  both are native modules needing per-platform builds, and this installs on a
  VPS, on Windows and inside a slim container. scrypt is memory-hard and in
  the standard library.
- **Sessions** are rows in `sessions`, not signed tokens, so signing out
  revokes access immediately instead of at expiry. Only the SHA-256 of each
  token is stored — a database dump does not hand over live sessions.
- **The cookie** is httpOnly and SameSite=Lax, and `Secure` in production
  unless `INSECURE_COOKIES=true`, which exists because the default deployment
  runs on a bare IP over HTTP before a domain and certificate exist.
- **Deletion** removes the row and the photo file. Who may delete is decided
  by one function, `canDelete()` in `src/lib/serialize.ts`, called both by the
  serializer that decides whether the client renders a delete button and by
  the DELETE handler that enforces it — so the two cannot drift apart. A
  forged `canDelete` in a response body buys nothing.
- **Deleting an account** leaves its cameras on the map, owned by nobody
  (`on delete set null`), rather than silently erasing contributions.

---

## The database

Postgres. [`db/schema.sql`](db/schema.sql) is the source of truth for
everything Prisma cannot express — the `location` geometry column with its sync
trigger and GiST index, and the check constraints. `prisma/schema.prisma`
declares the same table with `@map()` so the TypeScript field names (`lat`,
`lng`) stay readable while the columns are `latitude`, `longitude`.

Positions are stored as plain `latitude`/`longitude` floats, and — where
PostGIS is installed — also as a `geometry(Point, 4326)`.

**PostGIS is optional.** The bounding-box query in
`src/app/api/cameras/route.ts` filters on the two scalars, so it needs no
PostGIS-aware SQL and handles the antimeridian; there is no `$queryRaw`
anywhere in the app. The geometry column is there for radius and
nearest-neighbour queries later — worked examples are at the bottom of
`db/schema.sql` — so the schema creates it where the extension exists and
quietly skips it where it does not. That is what lets a stock Windows Postgres
run this unmodified. Install PostGIS afterwards and re-apply the schema file:
it adds the column, backfills it from the existing rows, and creates the
trigger and index.

Because the trigger derives `location` from the two scalars, application writes
never touch it either way.

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

[`scripts/install-linux.sh`](scripts/install-linux.sh) does all of it on a bare Ubuntu
22.04 or 24.04 server.

```bash
git clone <your-fork> /opt/project-anpr && cd /opt/project-anpr

./scripts/install-linux.sh --check     # what's installed, what's missing; changes nothing

sudo ./scripts/install-linux.sh        # site on http://<server-ip>:3000
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

cd /opt/project-anpr && git pull && sudo ./scripts/install-linux.sh   # redeploy
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
sudo ./scripts/install-linux.sh --nginx --domain anpr.example.com --email you@example.com
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

### On a Linux box without systemd

`install-linux.sh` installs `project-anpr.service` so the site survives a
reboot, which is what you want on a real server. If you're instead running
this on a Linux desktop, in a container, or anywhere else you don't want a
systemd unit, [`scripts/start-linux.sh`](scripts/start-linux.sh) is a plain
foreground launcher — it does no installing or configuring, just checks `.env`
and a build exist and runs the server:

```bash
./scripts/start-linux.sh            # production server on :3000
./scripts/start-linux.sh --dev      # dev server, hot reload
PORT=8080 ./scripts/start-linux.sh  # a different port
```

It refuses to start a second copy if `project-anpr.service` is already
running under systemd, so the two paths don't collide.

---

## Running it from a Windows PC

Everything on your own machine — Postgres, the photos, the app — reachable
from the internet through a Cloudflare Tunnel. Free apart from the domain, no
port forwarding, no public IP, no inbound firewall holes: `cloudflared` makes
an *outbound* connection to Cloudflare and traffic comes back down it. You get
real HTTPS, so the capture flow works.

```powershell
git clone https://github.com/jazyt3871/Project-ANPR.git
cd Project-ANPR

.\scripts\install-windows.ps1 -Check        # what's installed; changes nothing

.\scripts\install-windows.ps1 -Seed         # install, database, build
.\scripts\start-windows.ps1                # http://localhost:3000
```

[`scripts\install-windows.ps1`](scripts/install-windows.ps1) installs Node and
PostgreSQL with winget where they're missing, creates the role and database,
applies `db/schema.sql`, writes `.env` with a generated password and salt,
and builds. Re-running it after a `git pull` rebuilds in place and reuses the
password already in `.env`.

**PostGIS is not required here.** `db/schema.sql` checks for it and skips the
geometry column and its index when it's absent — which is the normal case on
Windows, where PostGIS means a separate Stack Builder run. Nothing the app
does today touches that column (see [The database](#the-database)), so a stock
Windows Postgres is fully functional. Install PostGIS later and re-run the
schema file: it adds the column, trigger and index to the existing table.

### Putting it on your domain

Add your domain to Cloudflare first (at
[dash.cloudflare.com](https://dash.cloudflare.com) — it walks you through
pointing your registrar's nameservers at them). Then:

```powershell
.\scripts\install-windows.ps1 -Tunnel -Domain anpr.example.com
```

which installs `cloudflared` and prints the commands for your hostname:

```powershell
cloudflared tunnel login
cloudflared tunnel create project-anpr
cloudflared tunnel route dns project-anpr anpr.example.com

# leave running, alongside .\scripts\start-windows.ps1
cloudflared tunnel run --url http://localhost:3000 project-anpr
```

Certificates are handled by Cloudflare; there's no certbot step.

### Starting it again later

[`scripts\start-windows.ps1`](scripts/start-windows.ps1) is the lightweight
counterpart to `install-windows.ps1` — no installing or configuring, it just
checks `.env` and a build exist and starts the server:

```powershell
.\scripts\start-windows.ps1            # production server on :3000
.\scripts\start-windows.ps1 -Dev       # dev server, hot reload
.\scripts\start-windows.ps1 -Port 8080 # a different port
```

### Keeping it up

Two things have to stay running: `start-windows.ps1` and the tunnel. For a
permanent setup, install both as Windows services rather than leaving
terminals open — `cloudflared service install` does the tunnel, and
[NSSM](https://nssm.cc/) is the usual way to wrap a script like this one.

Worth being honest about the trade-off: a home PC means the site is up only
while that machine is on and your internet is up, and sustained public traffic
runs through your home connection. Fine for something small; the
[VPS](#self-hosting-on-a-vps) or [Fly](#deploying-to-flyio-free-tier) routes
don't have that ceiling.

---

## Deploying to Fly.io (free tier)

Free, no domain needed, no VPS to patch — Fly's free allowance (3 shared
`shared-cpu-1x-256mb` machines, 3GB of volume storage) covers the app and the
database as two small Fly apps talking over Fly's private network. Nothing
public except the site itself.

Fly's own managed Postgres product does **not** ship PostGIS, so the database
here is the official `postgis/postgis` image run as a plain Fly Machine
instead — [`scripts/fly-db-setup.sh`](scripts/fly-db-setup.sh) does that part.

```bash
# 1. Install flyctl and log in — https://fly.io/docs/flyctl/install/
fly auth login

# 2. Database: creates the project-anpr-db app, a 1GB volume, and starts
#    postgis/postgis on it. Prints the connection string and password.
./scripts/fly-db-setup.sh --region iad

# 3. Apply the schema through a local tunnel to that private machine
fly proxy 5432 --app project-anpr-db &
psql "postgresql://anpr:<password-from-step-2>@127.0.0.1:5432/anpr" -f db/schema.sql
kill %1

# 4. App: create it, give it a volume for photos, set secrets, deploy
fly apps create project-anpr
fly volumes create uploads --app project-anpr --region iad --size 1
fly secrets set --app project-anpr \
  DATABASE_URL="postgresql://anpr:<password-from-step-2>@project-anpr-db.internal:5432/anpr" \
  SUBMITTER_SALT="$(openssl rand -hex 32)"
fly deploy
```

`fly deploy` builds [`Dockerfile`](Dockerfile) — a multi-stage build using
Next's `output: "standalone"` (set in `next.config.ts`), so the runtime image
carries only the files the server actually traced, not the full
`node_modules`. That matters at 256MB of RAM. [`fly.toml`](fly.toml) wires
`UPLOAD_DIR` to the mounted volume and sets `auto_stop_machines`, so the app
scales to zero — and stops costing anything — when nobody's visiting, and
starts again in about a second on the next request.

You'll get a `https://project-anpr.fly.dev` URL with a real certificate
already, so the capture flow works immediately — no separate HTTPS step like
the VPS needs.

Re-deploying after changes is `fly deploy` from the repo root; nothing else.

### Why not Fly's own Postgres, or Render / Railway

- **Fly Postgres** — their managed image is a great fit for a normal app, but
  it doesn't include PostGIS, and `location`'s trigger, index and the radius
  queries in `db/schema.sql` all depend on it. Running `postgis/postgis`
  ourselves is the same free-tier cost with the extension included.
- **Render** — the free Postgres tier is deleted after 90 days and the free
  web service cold-starts after 15 minutes idle; fine for a demo, not for
  something meant to stay up.
- **Railway** — no real free tier any more, trial credit only.

---

## Other ways to run it

The deployment model is one machine (or two, for Fly): Postgres, the photos
and the app together, or the app talking to a Postgres it can reach privately.
Anything that gives you a persistent filesystem and a Postgres works — a VPS
(above), Fly.io (above), a Render instance with a volume mounted at
`UPLOAD_DIR`, or plain Docker (below). Platforms with read-only or ephemeral
filesystems (Vercel, Netlify functions) do not: photos would vanish between
deploys. Supporting one means writing a second `StorageDriver` in
`src/lib/storage.ts` — the interface is two methods and nothing outside that
file would change.

### Docker

[`Dockerfile`](Dockerfile) is the same three-stage build Fly deploys above —
`npm ci` → `prisma generate && next build` (with `output: "standalone"` from
`next.config.ts`) → a slim runtime image with just the traced files. Works
anywhere Docker does, not only on Fly:

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

`scripts/install-linux.sh` handles the first three.

---

## Project structure

```
Dockerfile                 Multi-stage build; the image Fly and plain Docker both run
fly.toml                   Fly app config: volume, port, scale-to-zero
db/
  schema.sql               postgis, cameras, geometry trigger, rate-limit table
prisma/
  schema.prisma            Postgres; Camera + RateLimitHit models
scripts/
  seed.mjs                 Eight sample cameras + an embedded placeholder JPEG
  create-admin.mjs         Creates/promotes the admin, prints a generated password
  install-linux.sh          Ubuntu: deps, Postgres, systemd, nginx, ufw, TLS
  start-linux.sh            Foreground launcher for a Linux box without systemd
  install-windows.ps1       Windows: deps, Postgres, .env, build, Cloudflare Tunnel
  start-windows.ps1         Launcher: checks .env/build exist, runs the server
  fly-db-setup.sh          postgis/postgis as a Fly Machine, for fly.toml above
src/
  app/
    layout.tsx             Fonts, theme-before-paint script, shared SVG defs
    page.tsx               The map is the page
    globals.css            Design tokens, theme flip, Leaflet skin, glyph classes
    api/
      README.md            Full endpoint + field reference
      auth/                register, login, logout, me
      geo/route.ts         Country bounding box from the proxy's header
      cameras/route.ts     GET (bbox) + POST (multipart, needs an account)
      cameras/[id]/route.ts GET + DELETE (owner or admin)
      photos/[...key]/route.ts
  components/
    CameraMapApp.tsx       Shell: instrument strip, FAB, fetching, state
    MapView.tsx            Leaflet, rotated markers, accuracy disc, pin-drop
    AddCameraDrawer.tsx    Four-step flow orchestration
    CompassDial.tsx        Azimuth card under a fixed sightline
    CameraDetailSheet.tsx  Photo, bearing, coordinates, OSM link, delete
    UnlockGate.tsx         First-visit gate: sign in, register, or guest
    AuthSheet.tsx          Sign-in / registration form
    SightlineGlyph.tsx     The marker, as a React node
    SightlineDefs.tsx      Gradients, defined once for the whole document
    steps/                 One file per capture step
    ui/primitives.tsx      Button, Sheet, FieldRow, Notice
  hooks/
    useAuth.ts             Session state, sign in / register / sign out
    useGeolocation.ts      Converging high-accuracy fix
    useDeviceHeading.ts    Cross-platform compass + manual fallback
  lib/
    sightline.ts           The cone geometry — one definition, three renderers
    geo.ts                 Bearings, bbox parsing, circular mean, distance
    image.ts               Client-side downscale + EXIF strip
    auth.ts                scrypt passwords, database-backed sessions
    country-bounds.ts      ISO-3166 bounding boxes for the opening map view
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
