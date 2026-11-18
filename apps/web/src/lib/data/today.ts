import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const TZ = "Asia/Manila";

/** Manila calendar date as YYYY-MM-DD. */
export function manilaDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type LoadRow = {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  acwr: number | null;
  psycho_status: string | null;
  readiness: number | null;
  readiness_parts: { verdict?: string; band?: string; reason?: string } | null;
  warming_up: boolean;
};
export type WellRow = {
  date: string;
  rhr: number | null;
  hrv_night_avg: number | null;
  sleep_score: number | null;
  sleep_s: number | null;
  bb_wake: number | null;
  stress_avg: number | null;
};
export type Activity = {
  id: number;
  start_local: string;
  sport: "run" | "ride" | "strength" | "walk" | "other";
  name: string | null;
  duration_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  avg_speed_mps: number | null;
  aerobic_te: number | null;
  te_label: string | null;
  has_gps: boolean;
};
export type ChartJson = { route?: [number, number][]; hr?: { t: number[]; v: number[] } };
export type Race = { name: string; date: string | null; sport: string; distance_m: number | null; goal_s: number | null; priority: string };

export async function loadToday(sb: SupabaseClient) {
  const today = manilaDate();
  const since = addDays(today, -29);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow);

  const [load, well, last, week, cfg, pred, predOld, device] = await Promise.all([
    sb.from("daily_load").select("date, ctl, atl, tsb, acwr, psycho_status, readiness, readiness_parts, warming_up").gte("date", since).order("date"),
    sb.from("daily_wellness").select("date, rhr, hrv_night_avg, sleep_score, sleep_s, bb_wake, stress_avg").gte("date", since).order("date"),
    // Last *training* session: walks (commutes, errands) never headline Today or draw the route.
    sb.from("activities").select("id, start_local, sport, name, duration_s, moving_s, distance_m, avg_speed_mps, aerobic_te, te_label, has_gps").neq("sport", "walk").order("start_utc", { ascending: false }).limit(1),
    sb.from("activities").select("id, start_local, sport, distance_m, duration_s").gte("start_local", `${monday}T00:00:00`).order("start_local"),
    sb.from("athlete_config").select("goals, weekly_template").eq("id", 1).maybeSingle(),
    sb.from("race_predictions").select("date, hm_s, k10_s, k5_s, m_s").order("date", { ascending: false }).limit(1),
    sb.from("race_predictions").select("date, hm_s").lte("date", addDays(today, -28)).order("date", { ascending: false }).limit(1),
    sb.from("device_status").select("device_name, last_sync_at").eq("id", 1).maybeSingle(),
  ]);

  const lastActivity = (last.data?.[0] ?? null) as Activity | null;
  let lastMetric: { hrtss: number | null; hrtss_estimated: boolean | null } | null = null;
  let chart: ChartJson | null = null;
  if (lastActivity) {
    const [m, c] = await Promise.all([
      sb.from("activity_metrics").select("hrtss, hrtss_estimated").eq("activity_id", lastActivity.id).maybeSingle(),
      sb.from("activity_streams").select("chart").eq("activity_id", lastActivity.id).maybeSingle(),
    ]);
    lastMetric = m.data ?? null;
    chart = (c.data?.chart as ChartJson | undefined) ?? null;
  }

  return {
    today,
    monday,
    load: (load.data ?? []) as LoadRow[],
    wellness: (well.data ?? []) as WellRow[],
    lastActivity,
    lastMetric,
    chart,
    week: (week.data ?? []) as Pick<Activity, "id" | "start_local" | "sport" | "distance_m" | "duration_s">[],
    goals: (cfg.data?.goals ?? { races: [] }) as { races: Race[] },
    template: (cfg.data?.weekly_template ?? {}) as Record<string, string[]>,
    prediction: pred.data?.[0] ?? null,
    predictionOld: predOld.data?.[0] ?? null,
    device: device.data ?? null,
    errors: [load, well, last, week, cfg, pred, device].filter((r) => r.error).map((r) => r.error!.message),
  };
}

export type TodayData = Awaited<ReturnType<typeof loadToday>>;
