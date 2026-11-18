import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExerciseSet } from "./activity";
import { addDays, manilaDate } from "./today";

export type SportSession = {
  id: number;
  start_local: string;
  sport: "ride" | "strength";
  name: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_speed_mps: number | null;
  avg_hr: number | null;
  hrtss: number | null;
  hrtss_estimated: boolean | null;
  /** Strength only: active sets with Garmin's exercise guess. */
  sets: { category: string | null; reps: number | null; weight: number | null }[];
};

/** Rides and strength sessions in the range, plus total load so strength's share can be shown. */
export async function loadSports(sb: SupabaseClient, days: number) {
  const since = addDays(manilaDate(), -(days - 1));
  const [acts, load] = await Promise.all([
    sb
      .from("activities")
      .select("id, start_local, sport, name, duration_s, distance_m, avg_speed_mps, avg_hr, exercise_sets:raw_unofficial->exercise_sets, m:activity_metrics(hrtss, hrtss_estimated)")
      .in("sport", ["ride", "strength"])
      .gte("start_local", `${since}T00:00:00`)
      .order("start_local"),
    sb.from("daily_load").select("tss_total, tss_strength, tss_ride").gte("date", since),
  ]);
  type Row = Omit<SportSession, "hrtss" | "hrtss_estimated" | "sets"> & {
    exercise_sets: ExerciseSet[] | null;
    m: { hrtss: number | null; hrtss_estimated: boolean | null } | null;
  };
  const sessions: SportSession[] = ((acts.data ?? []) as unknown as Row[]).map(({ m, exercise_sets, ...a }) => ({
    ...a,
    hrtss: m?.hrtss ?? null,
    hrtss_estimated: m?.hrtss_estimated ?? null,
    sets: (exercise_sets ?? [])
      .filter((st) => st.setType === "ACTIVE")
      .map((st) => {
        const ex = [...(st.exercises ?? [])].sort((p, q) => q.probability - p.probability)[0];
        return { category: ex && ex.category !== "UNKNOWN" ? ex.category : null, reps: st.repetitionCount ?? null, weight: st.weight ?? null };
      }),
  }));
  const totals = ((load.data ?? []) as { tss_total: number | null; tss_strength: number | null; tss_ride: number | null }[]).reduce(
    (a, r) => ({ total: a.total + (r.tss_total ?? 0), strength: a.strength + (r.tss_strength ?? 0), ride: a.ride + (r.tss_ride ?? 0) }),
    { total: 0, strength: 0, ride: 0 },
  );
  return { since, sessions, totals, failed: Boolean(acts.error || load.error) };
}

export type SportsData = Awaited<ReturnType<typeof loadSports>>;
