import { StatusMark, type StatusKind } from "@/components/ui/StatusMark";
import { requireOwner } from "@/lib/auth";
import { loadSettings, type SyncRun } from "@/lib/data/settings";
import { manilaDate } from "@/lib/data/today";
import * as f from "@/lib/format";
import { signOut } from "@/app/signin/actions";

import s from "../analysis.module.css";
import { ExpiryForm, GoalsForm, HeartRateForm, TemplateForm } from "./SettingsForms";
import st from "./settings.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Psycho" };

const SOURCE: Record<string, { label: string; kind: StatusKind }> = {
  ok: { label: "OK", kind: "good" },
  degraded: { label: "Degraded", kind: "warning" },
  needs_login: { label: "Needs login", kind: "serious" },
};
const SOURCE_HELP: Record<string, string> = {
  needs_login: "Garmin sign-in expired. Run the login command on your Mac to reconnect (docs/SETUP.md).",
  degraded: "Some calls failed on the last run. It usually clears on the next sync.",
};
const BUDGET = 1800; // spec §6.3: stay under 1,800 of the free 2,000 Actions minutes

function runSeconds(r: { started_at: string; finished_at: string | null }) {
  return r.finished_at ? (+new Date(r.finished_at) - +new Date(r.started_at)) / 1000 : null;
}

function runSummary(r: SyncRun) {
  const c = (r.counts ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.activities_written === "number") parts.push(`${c.activities_written} new ${c.activities_written === 1 ? "activity" : "activities"}`);
  if (typeof c.wellness_days === "number") parts.push(`${c.wellness_days} wellness ${c.wellness_days === 1 ? "day" : "days"}`);
  if (typeof c.months === "number") parts.push(`${c.months} months`);
  if (typeof c.recompute_requests === "number" && c.recompute_requests) parts.push("history recomputed");
  return parts.join(" · ");
}

export default async function SettingsPage() {
  const sb = await requireOwner();
  const d = await loadSettings(sb);
  const cfg = d.config;
  const last = d.runs.find((r) => r.trigger === "sync" || r.trigger === "nightly") ?? d.runs[0] ?? null;

  // Actions minutes: GitHub rounds each job up to the minute; ~30 s of setup sits on top of
  // the worker's own time. An estimate from sync_runs, so labelled as one.
  const now = new Date();
  const used = d.monthRuns.reduce((a, r) => a + Math.ceil(((runSeconds(r) ?? 60) + 30) / 60), 0);
  const dayOfMonth = now.getUTCDate() - 1 + now.getUTCHours() / 24;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0.5 ? Math.round((used / dayOfMonth) * daysInMonth) : null;

  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Settings</h1>
      </header>
      <div className={s.grid}>
        <section className={`${s.band} ${s.wide}`} aria-labelledby="sync">
          <h2 id="sync" className={st.h2}>
            Sync health
          </h2>
          <ul className={s.list}>
            {(["official", "unofficial"] as const).map((k) => {
              const v = last?.source_status?.[k] ?? null;
              const meta = v ? (SOURCE[v] ?? { label: v, kind: "warning" as const }) : { label: "No data", kind: "none" as const };
              return (
                <li key={k} className={s.item}>
                  <span className={s.itemMain}>
                    <span className={s.itemName}>{k === "official" ? "Garmin Personal API" : "Garmin Connect"}</span>
                    <span className={s.itemMeta}>{(v && SOURCE_HELP[v]) || (k === "official" ? "Activities and FIT files" : "Wellness, VO2 max, race predictions, records")}</span>
                  </span>
                  <span className={st.status}>
                    <StatusMark kind={meta.kind} label={meta.label} />
                  </span>
                </li>
              );
            })}
            <li className={s.item}>
              <span className={s.itemMain}>
                <span className={s.itemName}>{d.device?.device_name ?? "Watch"}</span>
                <span className={s.itemMeta}>Last synced with Garmin Connect</span>
              </span>
              <span className={s.itemValue}>
                {f.ago(d.device?.last_sync_at)}
                {d.device?.last_sync_at ? <small>{f.dateTime(d.device.last_sync_at)}</small> : null}
              </span>
            </li>
          </ul>
          {d.pending.length ? (
            <p className={s.note}>
              Waiting: {d.pending.map((p) => (p.kind === "recompute" ? "recompute history (tonight)" : "sync")).join(", ")}, requested {f.ago(d.pending[0]!.requested_at)}.
            </p>
          ) : null}

          <h3 className={st.h3}>Last 20 runs</h3>
          <ol className={s.list}>
            {d.runs.map((r) => {
              const secs = runSeconds(r);
              const kind: StatusKind = r.status === "ok" ? "good" : r.status === "running" ? "none" : r.status === "degraded" ? "warning" : "serious";
              return (
                <li key={r.id} className={s.item}>
                  <span className={s.itemMain}>
                    <span className={s.itemName}>
                      <StatusMark kind={kind} label={`${r.trigger.charAt(0).toUpperCase()}${r.trigger.slice(1)} · ${r.status}`} />
                    </span>
                    <span className={s.itemMeta}>
                      {f.dateTime(r.started_at)}
                      {runSummary(r) ? ` · ${runSummary(r)}` : ""}
                    </span>
                    {r.error ? (
                      <span className={st.error} title={r.error}>
                        {r.error.length > 140 ? `${r.error.slice(0, 140).trimEnd()}…` : r.error}
                      </span>
                    ) : null}
                  </span>
                  <span className={s.itemValue}>{secs == null ? "–" : secs < 90 ? `${Math.round(secs)} s` : f.duration(secs)}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <div className={`${s.narrow} ${st.stack}`}>
          <section className={s.band} aria-labelledby="minutes">
            <h2 id="minutes" className={st.h2}>
              GitHub Actions
            </h2>
            <dl className={s.stats}>
              <div>
                <dt>This month, about</dt>
                <dd>{f.num(used)} min</dd>
              </div>
              <div>
                <dt>Projected</dt>
                <dd>{projected == null ? "–" : `${f.num(projected)} min`}</dd>
              </div>
            </dl>
            <p className={s.note}>
              <StatusMark kind={projected != null && projected > BUDGET ? "warning" : "good"} label={projected != null && projected > BUDGET ? `Over the ${f.num(BUDGET)}-minute budget.` : `Inside the ${f.num(BUDGET)}-minute budget.`} /> Estimated from {d.monthRuns.length} sync and nightly runs this month; GitHub rounds each run up to a whole minute. GitHub&apos;s billing page has the exact figure.
            </p>
          </section>

          <section className={s.band} aria-labelledby="keys">
            <h2 id="keys" className={st.h2}>
              Keys and tokens
            </h2>
            <ExpiryForm today={manilaDate()} apiKey={cfg?.personal_api_key_expires_at ?? null} github={cfg?.github_token_expires_at ?? null} />
          </section>

          <section className={s.band} aria-labelledby="account">
            <h2 id="account" className={st.h2}>
              Account
            </h2>
            <p className={s.note}>Dark theme only for now. Signing out ends this device&apos;s session.</p>
            <form action={signOut}>
              <button type="submit" className={st.button}>
                Sign out
              </button>
            </form>
          </section>
        </div>

        <section className={`${s.band} ${s.half}`} aria-labelledby="hr">
          <h2 id="hr" className={st.h2}>
            Heart rate
          </h2>
          <HeartRateForm
            config={cfg}
            autoRest={d.autoRest}
            recomputeQueued={d.pending.some((p) => p.kind === "recompute")}
          />
        </section>

        <section className={`${s.band} ${s.half}`} aria-labelledby="week">
          <h2 id="week" className={st.h2}>
            Training week
          </h2>
          <p className={s.note}>What you plan each day. Today&apos;s verdict suggests a change when your readiness says so.</p>
          <TemplateForm template={cfg?.weekly_template ?? {}} />
        </section>

        <section className={`${s.band} ${s.full}`} aria-labelledby="goals">
          <h2 id="goals" className={st.h2}>
            Goals
          </h2>
          <GoalsForm goals={cfg?.goals ?? { races: [] }} />
        </section>
      </div>
    </main>
  );
}
