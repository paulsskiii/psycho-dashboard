import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Race } from "./today";

export type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  status: string;
  source_status: { official?: string; unofficial?: string } | null;
  counts: Record<string, unknown> | null;
  error: string | null;
};
export type Template = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", string[]>>;
export type GoalsJson = {
  races: Race[];
  long_term?: { label: string; goal_s: number | null }[];
  target_weight_kg?: number | null;
  bests?: Record<string, number>;
};
export type Config = {
  max_hr: number | null;
  rest_hr_override: number | null;
  lthr: number | null;
  z2_band: number[] | null;
  hr_zones: { floors?: number[]; max_hr?: number; rest_hr?: number } | null;
  goals: GoalsJson | null;
  weekly_template: Template | null;
  personal_api_key_expires_at: string | null;
  github_token_expires_at: string | null;
  updated_at: string;
};

/** Everything Settings shows. Runs this month feed the Actions-minutes estimate. */
export async function loadSettings(sb: SupabaseClient) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [cfg, runs, month, device, pending, rhr] = await Promise.all([
    sb
      .from("athlete_config")
      .select("max_hr, rest_hr_override, lthr, z2_band, hr_zones, goals, weekly_template, personal_api_key_expires_at, github_token_expires_at, updated_at")
      .eq("id", 1)
      .maybeSingle(),
    sb.from("sync_runs").select("id, started_at, finished_at, trigger, status, source_status, counts, error").order("id", { ascending: false }).limit(20),
    sb.from("sync_runs").select("started_at, finished_at, trigger").gte("started_at", monthStart).in("trigger", ["sync", "nightly"]),
    sb.from("device_status").select("device_name, last_sync_at").eq("id", 1).maybeSingle(),
    sb.from("sync_requests").select("requested_at, kind").is("handled_at", null).order("requested_at"),
    sb.from("daily_wellness").select("rhr").not("rhr", "is", null).order("date", { ascending: false }).limit(7),
  ]);
  const rhrs = ((rhr.data ?? []) as { rhr: number }[]).map((r) => r.rhr).sort((a, b) => a - b);
  const autoRest = rhrs.length ? rhrs[Math.floor((rhrs.length - 1) / 2)]! : null;
  return {
    config: (cfg.data ?? null) as Config | null,
    runs: (runs.data ?? []) as SyncRun[],
    monthRuns: (month.data ?? []) as { started_at: string; finished_at: string | null; trigger: string }[],
    device: (device.data ?? null) as { device_name: string | null; last_sync_at: string | null } | null,
    pending: (pending.data ?? []) as { requested_at: string; kind: string }[],
    autoRest,
    failed: [cfg, runs, month, device, pending, rhr].some((r) => r.error),
  };
}

export type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
