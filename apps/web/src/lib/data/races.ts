import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate, type Race } from "./today";

export type Prediction = { date: string; k5_s: number | null; k10_s: number | null; hm_s: number | null; m_s: number | null };
export type PersonalRecord = { type: string; value: number; activity_id: number | null; achieved_on: string | null };
export type Effort = { id: number; start_local: string; name: string | null; distance_m: number; time_s: number };
export type Goals = { races: Race[]; long_term?: { label: string; goal_s: number | null }[] };

/** /races: predictor trend for the range; Riegel always from the last 60 days (spec §8.7). */
export async function loadRaces(sb: SupabaseClient, days: number) {
  const today = manilaDate();
  const since = addDays(today, -(days - 1));
  const [preds, prior, prs, cfg, runs] = await Promise.all([
    sb.from("race_predictions").select("date, k5_s, k10_s, hm_s, m_s").gte("date", since).order("date"),
    sb.from("race_predictions").select("date, k5_s, k10_s, hm_s, m_s").lte("date", addDays(today, -28)).order("date", { ascending: false }).limit(1),
    sb.from("personal_records").select("type, value, activity_id, achieved_on").like("type", "run_%"),
    sb.from("athlete_config").select("goals").eq("id", 1).maybeSingle(),
    // Outdoor runs only: wrist-estimated treadmill distance isn't race evidence.
    sb
      .from("activities")
      .select("id, start_local, name, distance_m, moving_s, duration_s")
      .eq("sport", "run")
      .eq("indoor", false)
      .gte("distance_m", 5000)
      .gte("start_local", `${addDays(today, -59)}T00:00:00`),
  ]);
  const efforts: Effort[] = ((runs.data ?? []) as { id: number; start_local: string; name: string | null; distance_m: number; moving_s: number | null; duration_s: number | null }[])
    .map((r) => ({ id: r.id, start_local: r.start_local, name: r.name, distance_m: r.distance_m, time_s: r.moving_s ?? r.duration_s ?? 0 }))
    .filter((r) => r.time_s > 0);
  return {
    today,
    predictions: (preds.data ?? []) as Prediction[],
    prior: ((prior.data ?? [])[0] ?? null) as Prediction | null,
    records: (prs.data ?? []) as PersonalRecord[],
    goals: (cfg.data?.goals ?? { races: [] }) as Goals,
    efforts,
    failed: [preds, prior, prs, cfg, runs].some((r) => r.error),
  };
}

export type RacesData = Awaited<ReturnType<typeof loadRaces>>;
