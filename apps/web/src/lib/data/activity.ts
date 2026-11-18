import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ChartChannel = { t: number[]; v: number[] };
export type ActivityChart = Partial<Record<"dist" | "hr" | "speed" | "cadence" | "power" | "alt", ChartChannel>> & {
  route?: [number, number][];
};
export type Split = {
  idx: number;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
  avg_cadence: number | null;
  elev_gain_m: number | null;
};
export type ExerciseSet = {
  exercises?: { category: string; name: string | null; probability: number }[];
  duration?: number;
  repetitionCount?: number | null;
  weight?: number | null;
  setType?: string;
};

export async function loadActivity(sb: SupabaseClient, id: number) {
  const [a, m, st, laps, cfg] = await Promise.all([
    sb
      .from("activities")
      .select(
        "id, start_local, sport, garmin_type, name, duration_s, moving_s, distance_m, elev_gain_m, avg_hr, max_hr, avg_speed_mps, avg_cadence, avg_power, calories, aerobic_te, anaerobic_te, te_label, vo2max, weather, has_gps, indoor, has_workout, exercise_sets:raw_unofficial->exercise_sets",
      )
      .eq("id", id)
      .maybeSingle(),
    sb.from("activity_metrics").select("hrtss, hrtss_estimated, zone_s, low_pct, mod_pct, high_pct, ef, decoupling_pct, pace_at_hr_s_per_km, steady, drifted_hard, hilly").eq("activity_id", id).maybeSingle(),
    sb.from("activity_streams").select("chart").eq("activity_id", id).maybeSingle(),
    sb.from("activity_laps").select("idx, duration_s, distance_m, avg_hr, avg_speed_mps, avg_cadence, elev_gain_m").eq("activity_id", id).eq("kind", "km").order("idx"),
    sb.from("athlete_config").select("hr_zones").eq("id", 1).maybeSingle(),
  ]);
  if (!a.data) return null;

  // Km markers from the full-resolution track (computed here so the browser only gets ~20 points).
  const kmMarks: { km: number; at: [number, number] }[] = [];
  if (a.data.has_gps) {
    const full = await sb.from("activity_streams").select("lat, lon, dist").eq("activity_id", id).maybeSingle();
    const { lat, lon, dist } = (full.data ?? {}) as { lat?: (number | null)[]; lon?: (number | null)[]; dist?: (number | null)[] };
    if (lat && lon && dist) {
      let next = 1000;
      for (let i = 0; i < dist.length; i++) {
        const d = dist[i];
        if (d != null && d >= next && lat[i] != null && lon[i] != null) {
          kmMarks.push({ km: next / 1000, at: [lat[i]!, lon[i]!] });
          next += 1000;
        }
      }
    }
  }

  return {
    kmMarks,
    activity: a.data as {
      id: number;
      start_local: string;
      sport: "run" | "ride" | "strength" | "walk" | "other";
      garmin_type: string | null;
      name: string | null;
      duration_s: number | null;
      moving_s: number | null;
      distance_m: number | null;
      elev_gain_m: number | null;
      avg_hr: number | null;
      max_hr: number | null;
      avg_speed_mps: number | null;
      avg_cadence: number | null;
      avg_power: number | null;
      calories: number | null;
      aerobic_te: number | null;
      anaerobic_te: number | null;
      te_label: string | null;
      vo2max: number | null;
      weather: { temp_c?: number; apparent_c?: number | null; humidity_pct?: number | null; wind_kph?: number | null; desc?: string | null } | null;
      has_gps: boolean;
      indoor: boolean;
      has_workout: boolean;
      exercise_sets: ExerciseSet[] | null;
    },
    metrics: m.data as {
      hrtss: number | null;
      hrtss_estimated: boolean | null;
      zone_s: number[] | null;
      ef: number | null;
      decoupling_pct: number | null;
      pace_at_hr_s_per_km: number | null;
      steady: boolean | null;
      drifted_hard: boolean | null;
      hilly: boolean | null;
    } | null,
    chart: (st.data?.chart ?? null) as ActivityChart | null,
    splits: (laps.data ?? []) as Split[],
    zoneFloors: ((cfg.data?.hr_zones as { floors?: number[] } | null)?.floors ?? null) as number[] | null,
  };
}

export type ActivityData = NonNullable<Awaited<ReturnType<typeof loadActivity>>>;
