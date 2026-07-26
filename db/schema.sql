-- ===========================================================================
-- Project ANPR — database setup
--
-- Postgres with PostGIS, running on the same machine as the app. Apply it with
--   psql "$DATABASE_URL" -f db/schema.sql
-- or let scripts/vps-setup.sh do it for you. Idempotent — re-running is
-- harmless.
--
-- There is no row-level security here: nothing but the app's own role ever
-- connects, and it owns the tables, so policies would be theatre. Photos are
-- not in the database at all — they are files under UPLOAD_DIR, served by
-- /api/photos.
--
-- WARNING: do not run `prisma db push` against a database set up by this
-- script. Prisma has no geometry type, so `location` is absent from
-- schema.prisma, and db push drops columns it does not know about — it would
-- take the geometry column, its trigger and its GiST index with it. This file
-- is the migration tool for this project; Prisma is only the query client.
-- ===========================================================================

create extension if not exists postgis;
-- gen_random_uuid() is built in from Postgres 13; pgcrypto covers older servers.
create extension if not exists pgcrypto;

set search_path = public, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. cameras
-- ---------------------------------------------------------------------------

create table if not exists public.cameras (
  id             uuid primary key default gen_random_uuid(),

  -- WGS84 position captured by navigator.geolocation
  latitude       double precision not null,
  longitude      double precision not null,
  accuracy       double precision,          -- horizontal accuracy radius, metres

  -- Where the camera looks: degrees clockwise from true north, [0, 360)
  heading        double precision not null,
  heading_source text not null default 'sensor',   -- 'sensor' | 'manual'

  -- Photo object *key* (YYYY/MM/<uuid>.<ext>), not a URL: the app derives the
  -- URL at read time, so storage can move between disk and a bucket without
  -- rewriting a single row.
  photo_key      text not null,
  photo_width    integer,
  photo_height   integer,

  note           text,
  captured_at    timestamptz not null,
  created_at     timestamptz not null default now(),

  -- Coarse, non-reversible submitter tag, for rate limiting only
  submitter_hash text,

  -- Maintained by the trigger below; never written by the application
  location       geometry(Point, 4326),

  constraint cameras_latitude_range  check (latitude  between  -90 and  90),
  constraint cameras_longitude_range check (longitude between -180 and 180),
  constraint cameras_heading_range   check (heading   >= 0 and heading < 360),
  constraint cameras_heading_source  check (heading_source in ('sensor', 'manual'))
);

-- Keep `location` in sync with latitude/longitude so the app only ever writes
-- the two scalars and spatial queries still work. The search_path is pinned
-- rather than inherited: a trigger that resolves st_* through the caller's
-- path is a function-hijacking vector.
create or replace function public.cameras_sync_location() returns trigger
  language plpgsql
  set search_path = public, pg_catalog
as $$
begin
  new.location := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326);
  return new;
end;
$$;

drop trigger if exists cameras_sync_location_trg on public.cameras;
create trigger cameras_sync_location_trg
  before insert or update of latitude, longitude on public.cameras
  for each row execute function public.cameras_sync_location();

-- Backfill anything inserted before the trigger existed
update public.cameras
   set location = st_setsrid(st_makepoint(longitude, latitude), 4326)
 where location is null;

create index if not exists cameras_location_gist on public.cameras using gist (location);
create index if not exists cameras_created_at_idx on public.cameras (created_at desc);
-- Backs the bounding-box scan in GET /api/cameras, which filters on the two
-- scalars rather than the geometry so it works without a PostGIS-aware query.
create index if not exists cameras_lat_lng_idx on public.cameras (latitude, longitude);

-- ---------------------------------------------------------------------------
-- 2. rate_limit_hits — shared state for the submission limiter
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_hits (
  id  bigserial primary key,
  key text        not null,
  at  timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_at_idx
  on public.rate_limit_hits (key, at desc);
