-- =============================================================================
-- KumbhConnect: public listing replica + review aggregates (Supabase / Postgres)
--
-- SOURCE OF TRUTH: Firestore `kc_listings` (+ `kc_reviews`). This schema is a
-- READ-ONLY public replica. Fields were derived from firestore.rules
-- (listingCreateKeys / validListingContent / isValidPhotoUrl / isValidLatLng)
-- and from how index_sos-fix.html reads listings. Nothing here is invented.
--
-- DELIBERATELY NOT REPLICATED (private / administrative):
--   ownerUid, phone, lastReviewId, the stored avgRating/reviewCount (the app
--   already distrusts them and recomputes from kc_reviews), reviewer uids and
--   review comments, users, SOS, grievances.
--
-- Only the trusted sync (service_role, via GitHub Actions) can write.
-- anon/authenticated can only SELECT approved rows.
--
-- NOT YET APPLIED to any live project. See supabase/tests/policy_checks.sql
-- to verify after applying.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Validation helpers (mirror firestore.rules isValidPhotoUrl / isValidListingPhotos)
-- CASE is used so jsonb_array_length is never evaluated on a non-array.
-- ---------------------------------------------------------------------------
create or replace function public.kc_is_valid_cloudinary_url(u text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select u is not null
     and char_length(u) <= 300
     and u ~ '^https://res\.cloudinary\.com/fzntl3lv/image/upload/[A-Za-z0-9/_.-]+$'
     and u !~ '\.\.'
$$;

create or replace function public.kc_is_valid_listing_photos(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p is null then false
    when jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) > 3 then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as e(v)
      where jsonb_typeof(e.v) <> 'string'
         or not public.kc_is_valid_cloudinary_url(e.v #>> '{}')
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- public_listings
-- Only APPROVED listings are ever stored. Revocation / deletion in Firestore =
-- the row is deleted here by the next sync (see sync_public_listings).
-- ---------------------------------------------------------------------------
create table if not exists public.public_listings (
  id                   text primary key
                         check (char_length(id) between 1 and 100),       -- Firestore doc id
  type                 text not null
                         check (type in ('business','service','guide','volunteer')),
  name                 text not null check (char_length(name) between 1 and 150),
  category             text check (category is null or char_length(category) <= 60),
  description          text check (description is null or char_length(description) <= 2000),
  address              text check (address is null or char_length(address) <= 300),
  services_list        text check (services_list is null or char_length(services_list) <= 1000),
  photos               jsonb not null default '[]'::jsonb
                         check (public.kc_is_valid_listing_photos(photos)),
  lat                  double precision,
  lng                  double precision,
  status               text not null default 'approved' check (status = 'approved'),
  source_create_time   timestamptz,                  -- Firestore document createTime
  source_update_time   timestamptz,                  -- Firestore document updateTime
  last_run_started_at  timestamptz not null,         -- sync run that last wrote the row
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint public_listings_latlng_chk check (
    (lat is null and lng is null)
    or (lat is not null and lng is not null
        and lat between -90 and 90 and lng between -180 and 180)
  )
);

create index if not exists public_listings_type_idx     on public.public_listings (type);
create index if not exists public_listings_category_idx on public.public_listings (category);

-- ---------------------------------------------------------------------------
-- public_listing_review_aggregates
-- Computed by the trusted sync from kc_reviews (integer ratings 1..5 only).
-- avg_rating is derived by the database; nobody can write it directly.
-- ---------------------------------------------------------------------------
create table if not exists public.public_listing_review_aggregates (
  listing_id           text primary key
                         references public.public_listings (id) on delete cascade,
  review_count         integer not null default 0 check (review_count >= 0),
  rating_sum           integer not null default 0 check (rating_sum >= 0),
  avg_rating           numeric(3,2) generated always as (
                         case when review_count = 0 then 0
                              else round(rating_sum::numeric / review_count, 2) end
                       ) stored,
  last_run_started_at  timestamptz not null,
  updated_at           timestamptz not null default now(),
  constraint public_listing_review_aggregates_sum_chk check (
    rating_sum >= review_count and rating_sum <= 5 * review_count
  )
);

-- ---------------------------------------------------------------------------
-- Sync bookkeeping (single row). Used to serialize runs and reject stale ones.
-- ---------------------------------------------------------------------------
create table if not exists public.public_listings_sync_state (
  singleton            boolean primary key default true check (singleton),
  last_run_started_at  timestamptz not null default '-infinity',
  last_success_at      timestamptz,
  last_listing_count   integer,
  last_aggregate_count integer
);
insert into public.public_listings_sync_state (singleton) values (true)
  on conflict (singleton) do nothing;

-- updated_at maintenance
create or replace function public.kc_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists public_listings_touch on public.public_listings;
create trigger public_listings_touch before update on public.public_listings
  for each row execute function public.kc_touch_updated_at();

drop trigger if exists public_listing_review_aggregates_touch on public.public_listing_review_aggregates;
create trigger public_listing_review_aggregates_touch before update on public.public_listing_review_aggregates
  for each row execute function public.kc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.public_listings                  enable row level security;
alter table public.public_listing_review_aggregates enable row level security;
alter table public.public_listings_sync_state       enable row level security;  -- no policies: only service_role (BYPASSRLS)

drop policy if exists public_listings_select_approved on public.public_listings;
create policy public_listings_select_approved
  on public.public_listings
  for select
  to anon, authenticated
  using (status = 'approved');

-- The sub-select is itself subject to the caller's RLS on public_listings.
drop policy if exists public_listing_review_aggregates_select_visible on public.public_listing_review_aggregates;
create policy public_listing_review_aggregates_select_visible
  on public.public_listing_review_aggregates
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.public_listings l
    where l.id = listing_id and l.status = 'approved'
  ));

-- No INSERT/UPDATE/DELETE policies exist for anon/authenticated. Privileges are
-- also revoked explicitly because Supabase's default privileges grant ALL on
-- new public tables to anon/authenticated/service_role.
revoke all on public.public_listings                  from public, anon, authenticated;
revoke all on public.public_listing_review_aggregates from public, anon, authenticated;
revoke all on public.public_listings_sync_state       from public, anon, authenticated;

grant select on public.public_listings                  to anon, authenticated;
grant select on public.public_listing_review_aggregates to anon, authenticated;

grant select, insert, update, delete on public.public_listings                  to service_role;
grant select, insert, update, delete on public.public_listing_review_aggregates to service_role;
grant select, insert, update, delete on public.public_listings_sync_state       to service_role;

-- ---------------------------------------------------------------------------
-- sync_public_listings: the ONLY write path. One transaction per call.
--   * serialized via a row lock on public_listings_sync_state
--   * stale protection: a run that STARTED before the last applied run is a no-op
--   * idempotent: upsert by stable Firestore id; re-running is harmless
--   * revocation/deletion: rows absent from the snapshot are deleted
--     (aggregates cascade)
--   * mass-delete guard: refuses an empty snapshot over existing rows, or a drop below
--     50% of existing rows (>=5 rows), unless p_allow_mass_delete is explicitly true
--   * any error rolls back everything (no partial state)
-- SECURITY INVOKER + execute only for service_role.
-- ---------------------------------------------------------------------------
create or replace function public.sync_public_listings(
  p_run_started_at     timestamptz,
  p_listings           jsonb,
  p_aggregates         jsonb,
  p_allow_mass_delete  boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_last      timestamptz;
  v_existing  integer;
  v_incoming  integer;
  v_upserted  integer;
  v_deleted   integer;
  v_agg       integer;
begin
  if p_run_started_at is null then
    raise exception 'p_run_started_at is required' using errcode = '22023';
  end if;
  -- a far-future timestamp would lock out every later run
  if p_run_started_at > now() + interval '10 minutes' then
    raise exception 'p_run_started_at is in the future' using errcode = '22023';
  end if;
  if p_listings is null or jsonb_typeof(p_listings) <> 'array' then
    raise exception 'p_listings must be a JSON array' using errcode = '22023';
  end if;
  if p_aggregates is null or jsonb_typeof(p_aggregates) <> 'array' then
    raise exception 'p_aggregates must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_listings) > 20000 then
    raise exception 'too many listings in one run' using errcode = '22023';
  end if;

  insert into public.public_listings_sync_state (singleton) values (true)
    on conflict (singleton) do nothing;

  select s.last_run_started_at into v_last
  from public.public_listings_sync_state s
  where s.singleton
  for update;

  if p_run_started_at < v_last then
    return jsonb_build_object('status', 'stale', 'last_applied_run', v_last);
  end if;

  v_incoming := jsonb_array_length(p_listings);
  select count(*) into v_existing from public.public_listings;

  -- An empty snapshot over a non-empty replica is never accepted implicitly; larger drops need >= 5 rows.
  if not coalesce(p_allow_mass_delete, false)
     and v_existing > 0
     and (v_incoming = 0 or (v_existing >= 5 and v_incoming < v_existing * 0.5)) then
    raise exception 'mass-delete guard: % incoming vs % existing; re-run with allow_mass_delete if intended',
      v_incoming, v_existing using errcode = 'P0001';
  end if;

  insert into public.public_listings as t (
    id, type, name, category, description, address, services_list, photos,
    lat, lng, status, source_create_time, source_update_time, last_run_started_at
  )
  select x.id, x.type, x.name, x.category, x.description, x.address, x.services_list,
         coalesce(x.photos, '[]'::jsonb),
         x.lat, x.lng, 'approved', x.source_create_time, x.source_update_time,
         p_run_started_at
  from jsonb_to_recordset(p_listings) as x(
    id text, type text, name text, category text, description text, address text,
    services_list text, photos jsonb, lat double precision, lng double precision,
    source_create_time timestamptz, source_update_time timestamptz
  )
  on conflict (id) do update set
    type = excluded.type,
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    address = excluded.address,
    services_list = excluded.services_list,
    photos = excluded.photos,
    lat = excluded.lat,
    lng = excluded.lng,
    status = 'approved',
    source_create_time = excluded.source_create_time,
    source_update_time = excluded.source_update_time,
    last_run_started_at = excluded.last_run_started_at
  where t.last_run_started_at <= excluded.last_run_started_at;
  get diagnostics v_upserted = row_count;

  -- revoked / deleted / unapproved in Firestore => no longer in the snapshot
  delete from public.public_listings l
  where not exists (
    select 1 from jsonb_to_recordset(p_listings) as y(id text) where y.id = l.id
  );
  get diagnostics v_deleted = row_count;

  insert into public.public_listing_review_aggregates as a (
    listing_id, review_count, rating_sum, last_run_started_at
  )
  select g.listing_id, g.review_count, g.rating_sum, p_run_started_at
  from jsonb_to_recordset(p_aggregates) as g(
    listing_id text, review_count integer, rating_sum integer
  )
  where exists (select 1 from public.public_listings l where l.id = g.listing_id)
  on conflict (listing_id) do update set
    review_count = excluded.review_count,
    rating_sum = excluded.rating_sum,
    last_run_started_at = excluded.last_run_started_at
  where a.last_run_started_at <= excluded.last_run_started_at;
  get diagnostics v_agg = row_count;

  update public.public_listings_sync_state
     set last_run_started_at = p_run_started_at,
         last_success_at = now(),
         last_listing_count = v_incoming,
         last_aggregate_count = v_agg
   where singleton;

  return jsonb_build_object(
    'status', 'ok',
    'listings_in_snapshot', v_incoming,
    'listings_upserted', v_upserted,
    'listings_deleted', v_deleted,
    'aggregates_upserted', v_agg
  );
end
$$;

revoke all on function public.sync_public_listings(timestamptz, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.sync_public_listings(timestamptz, jsonb, jsonb, boolean)
  to service_role;

commit;
