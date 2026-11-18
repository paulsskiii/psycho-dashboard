-- Psycho schema v1 (spec §5). Single-user. Every table has RLS; reads are owner-only;
-- writes come from the worker (service_role) or owner server actions.
-- The project was created with "automatically expose new tables" OFF, so every grant is explicit.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.athlete_config (
  id int primary key default 1 check (id = 1),
  owner_id uuid,
  owner_email text,
  timezone text not null default 'Asia/Manila',
  max_hr int,
  rest_hr_override int,
  lthr int,
  hr_zones jsonb,
  goals jsonb,
  weekly_template jsonb,
  personal_api_key_expires_at timestamptz,
  github_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.activities (
  id bigint primary key,
  start_utc timestamptz not null,
  start_local timestamp not null,
  sport text not null check (sport in ('run', 'ride', 'strength', 'walk', 'other')),
  garmin_type text,
  name text,
  duration_s int,
  moving_s int,
  distance_m real,
  elev_gain_m real,
  avg_hr int,
  max_hr int,
  avg_speed_mps real,
  avg_cadence real,
  avg_power real,
  calories int,
  aerobic_te real,
  anaerobic_te real,
  te_label text,
  vo2max real,
  recovery_time_h real,
  weather jsonb,
  has_gps boolean not null default false,
  indoor boolean not null default false,
  has_workout boolean not null default false,
  fit_path text,
  raw_official jsonb,
  raw_unofficial jsonb,
  synced_at timestamptz not null default now()
);
create index activities_start_utc_idx on public.activities (start_utc desc);
create index activities_sport_start_idx on public.activities (sport, start_utc desc);

create table public.activity_streams (
  activity_id bigint primary key references public.activities (id) on delete cascade,
  t int[],
  dist real[],
  hr int[],
  speed real[],
  cadence real[],
  power real[],
  alt real[],
  lat double precision[],
  lon double precision[],
  chart jsonb
);

create table public.activity_laps (
  activity_id bigint not null references public.activities (id) on delete cascade,
  idx int not null,
  kind text not null check (kind in ('lap', 'km', 'mile')),
  start_s int,
  duration_s int,
  distance_m real,
  avg_hr int,
  max_hr int,
  avg_speed_mps real,
  avg_cadence real,
  elev_gain_m real,
  primary key (activity_id, kind, idx)
);

create table public.activity_metrics (
  activity_id bigint primary key references public.activities (id) on delete cascade,
  trimp real,
  hrtss real,
  hrtss_estimated boolean,
  zone_s int[],
  low_pct real,
  mod_pct real,
  high_pct real,
  ef real,
  decoupling_pct real,
  pace_at_hr_s_per_km real,
  steady boolean,
  drifted_hard boolean,
  hilly boolean,
  computed_at timestamptz not null default now()
);

create table public.daily_wellness (
  date date primary key,
  rhr int,
  hrv_night_avg real,
  hrv_7d_avg real,
  hrv_baseline_low real,
  hrv_baseline_high real,
  hrv_status text,
  sleep_score int,
  sleep_s int,
  deep_s int,
  light_s int,
  rem_s int,
  awake_s int,
  bb_wake int,
  bb_high int,
  bb_low int,
  bb_charged int,
  bb_drained int,
  stress_avg int,
  respiration_avg real,
  spo2_avg real,
  steps int,
  vo2max real,
  fitness_age real,
  native_readiness int,
  native_training_status text,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create table public.daily_load (
  date date primary key,
  tss_total real,
  tss_run real,
  tss_ride real,
  tss_strength real,
  ctl real,
  atl real,
  tsb real,
  acwr real,
  ramp_7d real,
  psycho_status text,
  readiness int,
  readiness_parts jsonb,
  warming_up boolean not null default false
);

create table public.race_predictions (
  date date primary key,
  k5_s int,
  k10_s int,
  hm_s int,
  m_s int
);

create table public.personal_records (
  type text primary key,
  value real,
  activity_id bigint,
  achieved_on date
);

create table public.weigh_ins (
  ts timestamptz primary key,
  weight_kg real,
  body_fat_pct real,
  muscle_kg real,
  bone_kg real,
  water_pct real
);

create table public.sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null,
  status text not null default 'running',
  source_status jsonb,
  counts jsonb,
  error text
);
create index sync_runs_started_idx on public.sync_runs (started_at desc);

create table public.sync_requests (
  id bigserial primary key,
  requested_at timestamptz not null default now(),
  handled_at timestamptz
);

-- Not in the spec's table list: the header's "last watch sync" needs a home.
create table public.device_status (
  id int primary key default 1 check (id = 1),
  device_name text,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Seed (spec §1.1 and §5)
-- ---------------------------------------------------------------------------------------------

insert into public.athlete_config (id, goals, weekly_template) values (
  1,
  '{
    "races": [
      {"name": "Garmin Run Philippines", "date": "2026-12-13", "sport": "run", "distance_m": 21097, "goal_s": 7200, "priority": "A"},
      {"name": "Duaman Duathlon", "date": null, "sport": "duathlon", "distance_m": null, "goal_s": null, "priority": "A"}
    ],
    "bests": {"hm_s": 8277, "k10_s": 3364},
    "long_term": [{"label": "Full marathon", "goal_s": 14400}],
    "target_weight_kg": 64
  }'::jsonb,
  '{"mon": ["easy_run", "gym_upper"], "tue": ["intervals", "gym_legs"], "wed": ["gym_upper"],
    "thu": ["tempo", "prehab"], "fri": ["gym_upper"], "sat": ["long_run_or_rest"], "sun": ["long_run_or_rest"]}'::jsonb
);
insert into public.device_status (id) values (1);

-- ---------------------------------------------------------------------------------------------
-- RLS: owner-only reads; owner may update config and request syncs
-- ---------------------------------------------------------------------------------------------

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.uid() = (select owner_id from public.athlete_config where id = 1);
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'athlete_config', 'activities', 'activity_streams', 'activity_laps', 'activity_metrics',
    'daily_wellness', 'daily_load', 'race_predictions', 'personal_records', 'weigh_ins',
    'sync_runs', 'sync_requests', 'device_status'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (public.is_owner())', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy owner_update on public.athlete_config for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant update (timezone, max_hr, rest_hr_override, lthr, hr_zones, goals, weekly_template,
              personal_api_key_expires_at, github_token_expires_at, updated_at)
  on public.athlete_config to authenticated;

create policy owner_insert on public.sync_requests for insert to authenticated
  with check (public.is_owner());
grant insert on public.sync_requests to authenticated;

grant usage, select on all sequences in schema public to service_role;
grant usage, select on sequence public.sync_requests_id_seq to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Auth: only the owner's email may ever sign in; first sign-in claims owner_id
-- ---------------------------------------------------------------------------------------------

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner_email text;
  v_owner_id uuid;
begin
  select owner_email, owner_id into v_owner_email, v_owner_id from public.athlete_config where id = 1;
  if v_owner_email is null then
    raise exception 'Psycho: owner_email is not set; run `python -m psycho_worker set-owner <email>` first';
  end if;
  if lower(new.email) <> lower(v_owner_email) then
    raise exception 'Psycho: sign-up is disabled';
  end if;
  if v_owner_id is null then
    update public.athlete_config set owner_id = new.id, updated_at = now() where id = 1;
  elsif v_owner_id <> new.id then
    raise exception 'Psycho: owner already claimed';
  end if;
  return new;
end $$;

create trigger psycho_on_auth_user_created
  before insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------------------------
-- Storage: private FIT bucket + config backup bucket (worker writes via service_role)
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('fit', 'fit', false, 20971520), ('config', 'config', false, 1048576)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Vault: secrets reachable only through security-definer functions, service_role only
-- ---------------------------------------------------------------------------------------------

create or replace function public.get_secret(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name limit 1;
  return v;
end $$;

create or replace function public.set_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name limit 1;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end $$;

revoke execute on function public.get_secret(text) from public, anon, authenticated;
revoke execute on function public.set_secret(text, text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;
grant execute on function public.set_secret(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Atomic activity write (spec §6.2: never partially write an activity)
-- ---------------------------------------------------------------------------------------------

create or replace function public.jsonb_int_array(j jsonb) returns int[]
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'array' then null
    else (select array_agg(case when e = 'null' then null else (e)::int end order by o)
          from jsonb_array_elements_text(j) with ordinality as x(e, o)) end;
$$;

create or replace function public.jsonb_real_array(j jsonb) returns real[]
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'array' then null
    else (select array_agg(case when e = 'null' then null else (e)::real end order by o)
          from jsonb_array_elements_text(j) with ordinality as x(e, o)) end;
$$;

create or replace function public.jsonb_float8_array(j jsonb) returns double precision[]
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'array' then null
    else (select array_agg(case when e = 'null' then null else (e)::double precision end order by o)
          from jsonb_array_elements_text(j) with ordinality as x(e, o)) end;
$$;

create or replace function public.upsert_activity(
  p_activity jsonb,
  p_streams jsonb default null,
  p_laps jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id bigint := (p_activity->>'id')::bigint;
begin
  insert into public.activities
    select * from jsonb_populate_record(null::public.activities, p_activity)
  on conflict (id) do update set
    start_utc = excluded.start_utc, start_local = excluded.start_local, sport = excluded.sport,
    garmin_type = excluded.garmin_type, name = excluded.name, duration_s = excluded.duration_s,
    moving_s = excluded.moving_s, distance_m = excluded.distance_m, elev_gain_m = excluded.elev_gain_m,
    avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, avg_speed_mps = excluded.avg_speed_mps,
    avg_cadence = excluded.avg_cadence, avg_power = excluded.avg_power, calories = excluded.calories,
    aerobic_te = excluded.aerobic_te, anaerobic_te = excluded.anaerobic_te, te_label = excluded.te_label,
    vo2max = coalesce(excluded.vo2max, public.activities.vo2max),
    recovery_time_h = coalesce(excluded.recovery_time_h, public.activities.recovery_time_h),
    weather = coalesce(excluded.weather, public.activities.weather),
    has_gps = excluded.has_gps, indoor = excluded.indoor, has_workout = excluded.has_workout,
    fit_path = coalesce(excluded.fit_path, public.activities.fit_path),
    raw_official = coalesce(excluded.raw_official, public.activities.raw_official),
    raw_unofficial = coalesce(excluded.raw_unofficial, public.activities.raw_unofficial),
    synced_at = now();

  if p_streams is not null then
    insert into public.activity_streams (activity_id, t, dist, hr, speed, cadence, power, alt, lat, lon, chart)
    values (
      v_id,
      public.jsonb_int_array(p_streams->'t'),
      public.jsonb_real_array(p_streams->'dist'),
      public.jsonb_int_array(p_streams->'hr'),
      public.jsonb_real_array(p_streams->'speed'),
      public.jsonb_real_array(p_streams->'cadence'),
      public.jsonb_real_array(p_streams->'power'),
      public.jsonb_real_array(p_streams->'alt'),
      public.jsonb_float8_array(p_streams->'lat'),
      public.jsonb_float8_array(p_streams->'lon'),
      p_streams->'chart'
    )
    on conflict (activity_id) do update set
      t = excluded.t, dist = excluded.dist, hr = excluded.hr, speed = excluded.speed,
      cadence = excluded.cadence, power = excluded.power, alt = excluded.alt,
      lat = excluded.lat, lon = excluded.lon, chart = excluded.chart;
  end if;

  if p_laps is not null then
    delete from public.activity_laps where activity_id = v_id;
    insert into public.activity_laps
      select * from jsonb_populate_recordset(null::public.activity_laps, p_laps);
  end if;
end $$;

revoke execute on function public.upsert_activity(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_activity(jsonb, jsonb, jsonb) to service_role;

-- Spec §13: keep full-resolution streams for the last 12 months only; chart stays forever.
create or replace function public.trim_old_streams() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.activity_streams s
  set t = null, dist = null, hr = null, speed = null, cadence = null, power = null, alt = null,
      lat = null, lon = null
  from public.activities a
  where a.id = s.activity_id and a.start_utc < now() - interval '12 months' and s.t is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.trim_old_streams() from public, anon, authenticated;
grant execute on function public.trim_old_streams() to service_role;

-- ---------------------------------------------------------------------------------------------
-- Realtime (spec §5)
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.activities, public.daily_wellness, public.daily_load, public.sync_runs, public.device_status;
