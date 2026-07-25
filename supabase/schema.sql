-- ===========================================================================
-- Sightline — complete Supabase setup
--
-- Paste this whole file into the Supabase SQL Editor and press Run. It is
-- idempotent: running it twice is harmless.
--
-- It creates
--   1. the postgis extension
--   2. the `cameras` table (+ generated `location` point, trigger, GiST index)
--   3. the `rate_limit_hits` table used by the submission limiter
--   4. the public `camera-photos` storage bucket and its RLS policies
--
-- Column names here match the @map() names in prisma/schema.prisma exactly.
--
-- WARNING: do not run `prisma db push` against a database set up by this
-- script. Prisma has no geometry type, so `location` is absent from
-- schema.prisma, and db push drops columns it does not know about — it would
-- take the geometry column, its trigger and its GiST index with it. This file
-- is the migration tool for this project; Prisma is only the query client.
-- ===========================================================================

-- Supabase installs extensions into the `extensions` schema, not `public`, so
-- every reference to the postgis `geometry` type and the st_* functions below
-- needs that schema on the search path.
create extension if not exists postgis with schema extensions;

set search_path = public, extensions, pg_catalog;

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

  -- Photo in the camera-photos bucket. This is the object *key*
  -- (YYYY/MM/<uuid>.<ext>), not a full URL: the app derives the URL at read
  -- time, so the bucket can be flipped between public CDN and private
  -- streaming through /api/photos without rewriting a single row.
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
-- the two scalars and spatial queries still work.
-- The search_path is pinned rather than inherited: a SECURITY-sensitive trigger
-- that resolves st_* through the caller's path is a function-hijacking vector.
-- `extensions` must be in it, because that is where postgis lives on Supabase.
create or replace function public.cameras_sync_location() returns trigger
  language plpgsql
  set search_path = public, extensions, pg_catalog
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

-- Reads are public; writes go through the Next.js API routes using the
-- service-role key, which bypasses RLS. No client-side insert policy exists,
-- so the anon key cannot write rows directly.
alter table public.cameras enable row level security;

drop policy if exists "cameras are publicly readable" on public.cameras;
create policy "cameras are publicly readable"
  on public.cameras for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2. rate_limit_hits
--
-- The submission limiter needs shared state: on Vercel every request may hit a
-- different instance, so an in-process Map would let a submitter multiply their
-- quota by the number of warm lambdas.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_hits (
  id  bigserial primary key,
  key text        not null,
  at  timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_at_idx
  on public.rate_limit_hits (key, at desc);

alter table public.rate_limit_hits enable row level security;
-- No policies: service-role only. anon/authenticated get nothing.

-- ---------------------------------------------------------------------------
-- 3. camera-photos storage bucket
--
-- Public read so <img src> hits the Supabase CDN directly. Writes are
-- service-role only, matching the cameras table: uploads pass through
-- POST /api/cameras, which validates size, MIME type and magic numbers first.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'camera-photos',
  'camera-photos',
  true,
  8388608,                                       -- 8 MB, matches MAX_UPLOAD_BYTES
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "camera photos are publicly readable" on storage.objects;
create policy "camera photos are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'camera-photos');

-- ===========================================================================
-- Spatial queries this unlocks
--
--   -- cameras within 250 m of a point (cast to geography for metre distances)
--   select id, latitude, longitude, heading
--     from public.cameras
--    where st_dwithin(location::geography,
--                     st_makepoint(:lng, :lat)::geography,
--                     250);
--
--   -- nearest 20, sorted by true distance
--   select id, st_distance(location::geography,
--                          st_makepoint(:lng, :lat)::geography) as metres
--     from public.cameras
--    order by location <-> st_setsrid(st_makepoint(:lng, :lat), 4326)
--    limit 20;
-- ===========================================================================
