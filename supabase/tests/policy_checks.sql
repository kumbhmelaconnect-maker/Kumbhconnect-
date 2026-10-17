-- RLS / sync verification. Run AFTER applying the migration, in the Supabase SQL editor
-- (as postgres) or psql. Everything is rolled back at the end. Prefer a dev/empty project:
-- the seed calls sync with allow_mass_delete=true inside the transaction (rolled back).
-- STATUS: written but NOT executed by the author (no Postgres available in the build sandbox).
begin;

select public.sync_public_listings(
  now() - interval '1 minute',
  '[{"id":"T1","type":"guide","name":"Test One","photos":[],"lat":19.99,"lng":73.78},
    {"id":"T2","type":"service","name":"Test Two","category":"plumber","photos":["https://res.cloudinary.com/fzntl3lv/image/upload/v1/a.jpg"]}]'::jsonb,
  '[{"listing_id":"T1","review_count":2,"rating_sum":9},{"listing_id":"T2","review_count":0,"rating_sum":0}]'::jsonb,
  true);

-- 1. anon reads approved rows + aggregates
set local role anon;
do $$ begin
  if (select count(*) from public.public_listings where id in ('T1','T2')) <> 2 then raise exception 'FAIL anon cannot read listings'; end if;
  if (select avg_rating from public.public_listing_review_aggregates where listing_id='T1') <> 4.50 then raise exception 'FAIL avg_rating'; end if;
end $$;

-- 2. anon cannot write / read internals / call sync
do $$ begin
  begin insert into public.public_listings(id,type,name,last_run_started_at) values ('X','guide','x',now());
    raise exception 'FAIL anon insert allowed'; exception when insufficient_privilege then null; end;
  begin update public.public_listings set name='hacked'; raise exception 'FAIL anon update allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.public_listings; raise exception 'FAIL anon delete allowed'; exception when insufficient_privilege then null; end;
  begin update public.public_listing_review_aggregates set rating_sum=5; raise exception 'FAIL anon aggregate update allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.public_listings_sync_state; raise exception 'FAIL anon reads sync_state'; exception when insufficient_privilege then null; end;
  begin perform public.sync_public_listings(now(),'[]','[]',true); raise exception 'FAIL anon can call sync'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. authenticated: same restrictions
set local role authenticated;
do $$ begin
  begin insert into public.public_listings(id,type,name,last_run_started_at) values ('X','guide','x',now());
    raise exception 'FAIL authenticated insert allowed'; exception when insufficient_privilege then null; end;
  begin perform public.sync_public_listings(now(),'[]','[]',true); raise exception 'FAIL authenticated can call sync'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4. constraints reject bad data (even for the trusted role)
do $$ begin
  begin insert into public.public_listings(id,type,name,photos,last_run_started_at) values ('B1','guide','x','["https://evil.example/a.jpg"]',now());
    raise exception 'FAIL bad photo accepted'; exception when check_violation then null; end;
  begin insert into public.public_listings(id,type,name,lat,last_run_started_at) values ('B2','guide','x',10,now());
    raise exception 'FAIL lat without lng accepted'; exception when check_violation then null; end;
  begin insert into public.public_listings(id,type,name,last_run_started_at) values ('B3','admin','x',now());
    raise exception 'FAIL bad type accepted'; exception when check_violation then null; end;
  begin insert into public.public_listings(id,type,name,status,last_run_started_at) values ('B4','guide','x','pending',now());
    raise exception 'FAIL non-approved status accepted'; exception when check_violation then null; end;
end $$;

-- 5. idempotent re-run; stale run is a no-op; revocation removes the row
do $$ declare r jsonb; begin
  r := public.sync_public_listings(now(), (select jsonb_agg(jsonb_build_object('id',id,'type',type,'name',name,'photos',photos)) from public.public_listings where id in ('T1','T2')), '[]', true);
  if (select count(*) from public.public_listings where id in ('T1','T2')) <> 2 then raise exception 'FAIL not idempotent'; end if;
  r := public.sync_public_listings(now() - interval '1 hour', '[]', '[]', true);
  if r->>'status' <> 'stale' then raise exception 'FAIL stale run not rejected'; end if;
  if (select count(*) from public.public_listings where id in ('T1','T2')) <> 2 then raise exception 'FAIL stale run changed data'; end if;
  r := public.sync_public_listings(now(), '[{"id":"T1","type":"guide","name":"Test One","photos":[]}]', '[]', true);
end $$;
set local role anon;
do $$ begin
  if exists (select 1 from public.public_listings where id='T2') then raise exception 'FAIL revoked listing still visible'; end if;
  if exists (select 1 from public.public_listing_review_aggregates where listing_id='T2') then raise exception 'FAIL revoked aggregate visible'; end if;
end $$;
reset role;

select 'ALL POLICY CHECKS PASSED' as result;
rollback;
