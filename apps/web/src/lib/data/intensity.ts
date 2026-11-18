import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate } from "./today";

export type IntensityActivity = {
  id: number;
  start_local: string;
  sport: "run" | "ride";
  name: string | null;
  garmin_type: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  zone_s: number[] | null;
  low_pct: number | null;
  mod_pct: number | null;
  high_pct: number | null;
  drifted_hard: boolean | null;
};

/** Runs and rides in the range with their zone time (spec §8.6: the 80/20 check counts both). */
export async function loadIntensity(sb: SupabaseClient, days: number) {
  const since = addDays(manilaDate(), -(days - 1));
  const res = await sb
    .from("activities")
    .select("id, start_local, sport, name, garmin_type, duration_s, distance_m, avg_hr, m:activity_metrics(zone_s, low_pct, mod_pct, high_pct, drifted_hard)")
    .in("sport", ["run", "ride"])
    .gte("start_local", `${since}T00:00:00`)
    .order("start_local");
  type Row = Omit<IntensityActivity, "zone_s" | "low_pct" | "mod_pct" | "high_pct" | "drifted_hard"> & {
    m: Pick<IntensityActivity, "zone_s" | "low_pct" | "mod_pct" | "high_pct" | "drifted_hard"> | null;
  };
  const rows = ((res.data ?? []) as unknown as Row[]).map(({ m, ...a }) => ({
    ...a,
    zone_s: m?.zone_s ?? null,
    low_pct: m?.low_pct ?? null,
    mod_pct: m?.mod_pct ?? null,
    high_pct: m?.high_pct ?? null,
    drifted_hard: m?.drifted_hard ?? null,
  })) as IntensityActivity[];
  return { since, activities: rows, failed: Boolean(res.error) };
}

export type IntensityData = Awaited<ReturnType<typeof loadIntensity>>;
