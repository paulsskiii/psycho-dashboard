-- Settings page (spec §10): an editable "pace at fixed HR" band, and a request kind so
-- "Recompute history" waits for the nightly run instead of being swept up by the next sync.

alter table public.athlete_config
  add column z2_band int[]
  check (z2_band is null or (cardinality(z2_band) = 2 and z2_band[1] < z2_band[2]));

grant update (z2_band) on public.athlete_config to authenticated;

alter table public.sync_requests
  add column kind text not null default 'sync' check (kind in ('sync', 'recompute'));
