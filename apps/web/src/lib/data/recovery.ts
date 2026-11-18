import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate } from "./today";

export type RecoveryDay = {
  date: string;
  hrv_night_avg: number | null;
  hrv_7d_avg: number | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  hrv_status: string | null;
  sleep_score: number | null;
  sleep_s: number | null;
  deep_s: number | null;
  light_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  rhr: number | null;
  bb_wake: number | null;
  bb_high: number | null;
  bb_low: number | null;
  stress_avg: number | null;
  respiration_avg: number | null;
  spo2_avg: number | null;
};

export async function loadRecovery(sb: SupabaseClient, days: number) {
  const since = addDays(manilaDate(), -(days - 1));
  const res = await sb
    .from("daily_wellness")
    .select(
      "date, hrv_night_avg, hrv_7d_avg, hrv_baseline_low, hrv_baseline_high, hrv_status, sleep_score, sleep_s, deep_s, light_s, rem_s, awake_s, rhr, bb_wake, bb_high, bb_low, stress_avg, respiration_avg, spo2_avg",
    )
    .gte("date", since)
    .order("date");
  return { days: (res.data ?? []) as RecoveryDay[], failed: Boolean(res.error) };
}

export type RecoveryData = Awaited<ReturnType<typeof loadRecovery>>;
