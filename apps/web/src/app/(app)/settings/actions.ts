"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth";
import type { GoalsJson, Template } from "@/lib/data/settings";
import { DAYS, SESSIONS } from "@/lib/sessions";

export type FormState = { ok?: string; error?: string };


function int(form: FormData, key: string): number | null | "bad" {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : "bad";
}

function done(msg: string): FormState {
  revalidatePath("/", "layout");
  return { ok: msg };
}

/** HRmax, resting HR override, LTHR and the pace-at-HR band (spec §10). Recompute is separate. */
export async function saveHeartRate(_prev: FormState, form: FormData): Promise<FormState> {
  const sb = await requireOwner();
  const maxHr = int(form, "max_hr");
  const rest = int(form, "rest_hr_override");
  const lthr = int(form, "lthr");
  const lo = int(form, "z2_lo");
  const hi = int(form, "z2_hi");
  if ([maxHr, rest, lthr, lo, hi].includes("bad")) return { error: "Use whole numbers in beats per minute." };
  if (maxHr == null || (maxHr as number) < 120 || (maxHr as number) > 230) return { error: "Max heart rate should be between 120 and 230 bpm." };
  if (rest != null && ((rest as number) < 30 || (rest as number) > 90)) return { error: "Resting heart rate should be between 30 and 90 bpm, or blank to use your watch." };
  if (lthr != null && ((lthr as number) < 100 || (lthr as number) >= (maxHr as number))) return { error: "Threshold heart rate should be at least 100 bpm and below your max." };
  if ((lo == null) !== (hi == null)) return { error: "Fill in both ends of the band, or leave both blank for the default." };
  if (lo != null && ((lo as number) >= (hi as number) || (hi as number) >= (maxHr as number))) return { error: "The band's low end must be below its high end, and both below your max." };
  const { error } = await sb
    .from("athlete_config")
    .update({ max_hr: maxHr, rest_hr_override: rest, lthr, z2_band: lo == null ? null : [lo, hi], updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: "Couldn't save. Check your connection and try again." };
  return done("Saved. Press Recompute history to apply it to past activities.");
}

/** Queues a full metrics recompute; the nightly run picks it up (≈ 4 min of work). */
export async function requestRecompute(_prev: FormState): Promise<FormState> {
  const sb = await requireOwner();
  const open = await sb.from("sync_requests").select("id").is("handled_at", null).eq("kind", "recompute").limit(1);
  if (open.data?.length) return { ok: "Already queued for tonight's run." };
  const { error } = await sb.from("sync_requests").insert({ kind: "recompute" });
  if (error) return { error: "Couldn't queue it. Check your connection and try again." };
  return done("Queued. History is recomputed in tonight's 3:30 am run.");
}

export async function saveExpiry(_prev: FormState, form: FormData): Promise<FormState> {
  const sb = await requireOwner();
  const parse = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    if (!v) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+08:00` : "bad";
  };
  const key = parse("personal_api_key_expires_at");
  const gh = parse("github_token_expires_at");
  if (key === "bad" || gh === "bad") return { error: "Use a date like 2027-02-14." };
  const { error } = await sb.from("athlete_config").update({ personal_api_key_expires_at: key, github_token_expires_at: gh, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { error: "Couldn't save. Check your connection and try again." };
  return done("Saved.");
}

/** Goals arrive as JSON from the editor; validated field by field before writing. Keeps `bests`. */
export async function saveGoals(_prev: FormState, form: FormData): Promise<FormState> {
  const sb = await requireOwner();
  let input: GoalsJson;
  try {
    input = JSON.parse(String(form.get("goals") ?? ""));
  } catch {
    return { error: "Couldn't read the goals. Reload the page and try again." };
  }
  const races = Array.isArray(input.races) ? input.races : [];
  for (const r of races) {
    if (!String(r.name ?? "").trim()) return { error: "Every race needs a name." };
    if (r.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { error: `Check the date for ${r.name}.` };
    if (r.distance_m != null && !(r.distance_m > 0 && r.distance_m < 500000)) return { error: `Check the distance for ${r.name}.` };
    if (r.goal_s != null && !(r.goal_s > 0 && r.goal_s < 86400 * 2)) return { error: `Check the goal time for ${r.name}.` };
    if (!["A", "B", "C"].includes(r.priority)) return { error: `Priority for ${r.name} should be A, B or C.` };
  }
  const weight = input.target_weight_kg;
  if (weight != null && !(weight > 30 && weight < 200)) return { error: "Target weight should be between 30 and 200 kg." };
  const longTerm = (input.long_term ?? []).filter((g) => String(g.label ?? "").trim());
  const cur = await sb.from("athlete_config").select("goals").eq("id", 1).maybeSingle();
  const prev = (cur.data?.goals ?? {}) as GoalsJson;
  const goals: GoalsJson = {
    ...prev,
    races: races.map((r) => ({
      name: String(r.name).trim().slice(0, 80),
      date: r.date ?? null,
      sport: String(r.sport ?? "run").slice(0, 20),
      distance_m: r.distance_m ?? null,
      goal_s: r.goal_s ?? null,
      priority: r.priority,
    })),
    long_term: longTerm.map((g) => ({ label: String(g.label).trim().slice(0, 80), goal_s: g.goal_s ?? null })),
    target_weight_kg: weight ?? null,
  };
  const { error } = await sb.from("athlete_config").update({ goals, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { error: "Couldn't save. Check your connection and try again." };
  return done("Goals saved.");
}

export async function saveTemplate(_prev: FormState, form: FormData): Promise<FormState> {
  const sb = await requireOwner();
  const template: Template = {};
  for (const [d] of DAYS) {
    const picked = form.getAll(d).map(String).filter((v) => v in SESSIONS);
    if (picked.length) template[d] = picked;
  }
  const { error } = await sb.from("athlete_config").update({ weekly_template: template, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { error: "Couldn't save. Check your connection and try again." };
  return done("Week saved.");
}
