import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate } from "./today";

export type EfficiencyRun = {
  id: number;
  start_local: string;
  name: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  indoor: boolean;
  temp_c: number | null;
  ef: number | null;
  decoupling_pct: number | null;
  pace_at_hr_s_per_km: number | null;
  steady: boolean | null;
  hilly: boolean | null;
};

/** Runs in the range that have at least one efficiency metric (EF needs ≥ 30 min). */
export async function loadEfficiency(sb: SupabaseClient, days: number) {
  const since = addDays(manilaDate(), -(days - 1));
  const [res, cfg] = await Promise.all([
    sb
      .from("activities")
      .select(
        "id, start_local, name, duration_s, distance_m, avg_hr, indoor, temp_c:weather->temp_c, m:activity_metrics!inner(ef, decoupling_pct, pace_at_hr_s_per_km, steady, hilly)",
      )
      .eq("sport", "run")
      .gte("start_local", `${since}T00:00:00`)
      .not("m.ef", "is", null)
      .order("start_local"),
    sb.from("athlete_config").select("hr_zones").eq("id", 1).maybeSingle(),
  ]);
  type Row = Omit<EfficiencyRun, "ef" | "decoupling_pct" | "pace_at_hr_s_per_km" | "steady" | "hilly"> & {
    m: Pick<EfficiencyRun, "ef" | "decoupling_pct" | "pace_at_hr_s_per_km" | "steady" | "hilly">;
  };
  const runs = ((res.data ?? []) as unknown as Row[]).map(({ m, ...a }) => ({ ...a, ...m, temp_c: a.temp_c == null ? null : Number(a.temp_c) }));
  // Same default as the worker (metrics/constants.py): the upper half of Garmin zone 2.
  const floors = (cfg.data?.hr_zones as { floors?: number[] } | null)?.floors;
  const band = floors?.length === 5 ? ([Math.ceil((floors[1]! + floors[2]!) / 2), floors[2]! - 1] as [number, number]) : null;
  return { since, runs: runs as EfficiencyRun[], band, failed: Boolean(res.error) };
}

export type EfficiencyData = Awaited<ReturnType<typeof loadEfficiency>>;
