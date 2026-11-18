import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, manilaDate } from "./today";

export type WeighIn = {
  ts: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_kg: number | null;
  bone_kg: number | null;
  water_pct: number | null;
};

const manilaDay = (ts: string) => manilaDate(new Date(ts));

/** Weigh-ins in the range, one per Manila day (the last entry wins: a quick re-entry corrects a
 * typo), plus the most recent one ever so a quiet range still shows where you are. */
export async function loadBody(sb: SupabaseClient, days: number) {
  const since = addDays(manilaDate(), -(days - 1));
  const [rows, last, cfg] = await Promise.all([
    sb.from("weigh_ins").select("ts, weight_kg, body_fat_pct, muscle_kg, bone_kg, water_pct").gte("ts", `${since}T00:00:00+08:00`).order("ts"),
    sb.from("weigh_ins").select("ts, weight_kg, body_fat_pct, muscle_kg, bone_kg, water_pct").order("ts", { ascending: false }).limit(1),
    sb.from("athlete_config").select("goals").eq("id", 1).maybeSingle(),
  ]);
  const byDay = new Map<string, WeighIn>();
  for (const w of (rows.data ?? []) as WeighIn[]) if (w.weight_kg != null) byDay.set(manilaDay(w.ts), w);
  const daysList = [...byDay.entries()].map(([date, w]) => ({ date, ...w }));
  return {
    since,
    days: daysList,
    latest: (((last.data ?? [])[0] ?? null) as WeighIn | null),
    target: ((cfg.data?.goals as { target_weight_kg?: number } | null)?.target_weight_kg ?? null) as number | null,
    failed: [rows, last, cfg].some((r) => r.error),
  };
}

export type BodyData = Awaited<ReturnType<typeof loadBody>>;
