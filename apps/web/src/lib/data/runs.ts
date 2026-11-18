import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const SPORTS = ["all", "run", "ride", "strength", "walk"] as const;
export type SportFilter = (typeof SPORTS)[number];
export const PAGE_SIZE = 30;

export type ListRow = {
  id: number;
  start_local: string;
  start_utc: string;
  sport: "run" | "ride" | "strength" | "walk" | "other";
  name: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
  aerobic_te: number | null;
  has_gps: boolean;
  indoor: boolean;
  hrtss: number | null;
  hrtss_estimated: boolean | null;
  route: [number, number][] | null;
};

export function parseSport(v: string | undefined): SportFilter {
  return (SPORTS as readonly string[]).includes(v ?? "") ? (v as SportFilter) : "all";
}

/** Newest first, keyset-paginated on start_utc (stable under inserts from a running sync). */
export async function listActivities(sb: SupabaseClient, sport: SportFilter, before?: string) {
  let q = sb
    .from("activity_list")
    .select("id, start_local, start_utc, sport, name, duration_s, distance_m, avg_hr, avg_speed_mps, aerobic_te, has_gps, indoor, hrtss, hrtss_estimated, route")
    .order("start_utc", { ascending: false })
    .limit(PAGE_SIZE);
  if (sport !== "all") q = q.eq("sport", sport);
  if (before) q = q.lt("start_utc", before);
  const { data, error } = await q;
  const rows = (data ?? []) as ListRow[];
  return { rows, next: rows.length === PAGE_SIZE ? rows.at(-1)!.start_utc : null, failed: Boolean(error) };
}
