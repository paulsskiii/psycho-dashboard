import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate } from "./today";

export type FormLoad = {
  date: string;
  tss_run: number;
  tss_ride: number;
  tss_strength: number;
  ctl: number;
  atl: number;
  tsb: number;
  acwr: number | null;
  ramp_7d: number | null;
  psycho_status: string | null;
  warming_up: boolean;
};
export type TeActivity = { id: number; start_local: string; sport: string; aerobic_te: number | null; anaerobic_te: number | null };

/** Everything /form shows, for the selected range only (spec §12: fetch only the range shown). */
export async function loadForm(sb: SupabaseClient, days: number) {
  const today = manilaDate();
  const since = addDays(today, -(days - 1));
  const [load, vo2, acts] = await Promise.all([
    sb.from("daily_load").select("date, tss_run, tss_ride, tss_strength, ctl, atl, tsb, acwr, ramp_7d, psycho_status, warming_up").gte("date", since).order("date"),
    sb.from("daily_wellness").select("date, vo2max").gte("date", since).not("vo2max", "is", null).order("date"),
    sb.from("activities").select("id, start_local, sport, aerobic_te, anaerobic_te").gte("start_local", `${since}T00:00:00`).neq("sport", "walk").order("start_local"),
  ]);
  return {
    today,
    since,
    load: (load.data ?? []) as FormLoad[],
    vo2: (vo2.data ?? []) as { date: string; vo2max: number }[],
    activities: (acts.data ?? []) as TeActivity[],
    failed: [load, vo2, acts].some((r) => r.error),
  };
}

export type FormData = Awaited<ReturnType<typeof loadForm>>;
