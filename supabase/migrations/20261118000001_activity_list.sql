-- /runs list: one row per activity with its load and a ≤ ~48-point route thumbnail, so the list
-- never ships full 800-point routes. security_invoker keeps the owner-only RLS of the base tables.

create or replace function public.thin_route(route jsonb, target int default 48) returns jsonb
language sql immutable as $$
  select case
    when route is null or jsonb_typeof(route) <> 'array' or jsonb_array_length(route) = 0 then null
    else (
      select jsonb_agg(e order by i)
      from jsonb_array_elements(route) with ordinality as t(e, i)
      where (i - 1) % greatest(1, ceil(jsonb_array_length(route)::numeric / target)::int) = 0
         or i = jsonb_array_length(route)
    )
  end;
$$;

create or replace view public.activity_list with (security_invoker = true) as
select
  a.id,
  a.start_local,
  a.start_utc,
  a.sport,
  a.garmin_type,
  a.name,
  a.duration_s,
  a.moving_s,
  a.distance_m,
  a.avg_hr,
  a.avg_speed_mps,
  a.aerobic_te,
  a.has_gps,
  a.indoor,
  m.hrtss,
  m.hrtss_estimated,
  public.thin_route(s.chart -> 'route') as route
from public.activities a
left join public.activity_metrics m on m.activity_id = a.id
left join public.activity_streams s on s.activity_id = a.id;

revoke all on public.activity_list from anon, public;
grant select on public.activity_list to authenticated, service_role;
