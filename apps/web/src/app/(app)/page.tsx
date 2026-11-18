import Link from "next/link";

import { sport as sportColor } from "@psycho/tokens";

import { FormStrip } from "@/components/today/FormStrip";
import { OvernightTiles, type Tile } from "@/components/today/OvernightTiles";
import { RouteLine } from "@/components/today/RouteLine";
import { StatusMark, type StatusKind } from "@/components/ui/StatusMark";
import { requireOwner } from "@/lib/auth";
import { addDays, loadToday, type WellRow } from "@/lib/data/today";
import * as f from "@/lib/format";

import s from "./today.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today · Psycho" };

const BAND: Record<string, { label: string; kind: StatusKind }> = {
  primed: { label: "Primed", kind: "good" },
  steady: { label: "Steady", kind: "none" },
  hold_back: { label: "Hold back", kind: "warning" },
  recover: { label: "Recover", kind: "serious" },
};
const STATUS: Record<string, string> = {
  productive: "Productive",
  maintaining: "Maintaining",
  recovering: "Recovering",
  overreaching: "Overreaching",
  detraining: "Detraining",
  unproductive: "Unproductive",
};
const SESSION: Record<string, string> = {
  easy_run: "Easy run",
  intervals: "Intervals",
  tempo: "Tempo",
  long_run_or_rest: "Long run or rest",
  gym_upper: "Upper body",
  gym_legs: "Legs",
  prehab: "Prehab",
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SPORT_NAME: Record<string, string> = { run: "Run", ride: "Ride", strength: "Strength", walk: "Walk", other: "Other" };

function mean(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export default async function TodayPage() {
  const sb = await requireOwner();
  const d = await loadToday(sb);

  // Overnight: today's value if it synced, else the most recent night, labelled as such.
  const lastNight = [...d.wellness].reverse().find((w) => w.hrv_night_avg != null || w.sleep_score != null) ?? null;
  const nightDate = lastNight?.date ?? null;
  const history = d.wellness.filter((w) => nightDate && w.date < nightDate).slice(-28);
  const spark = (get: (w: WellRow) => number | null) => d.wellness.slice(-14).map(get);
  const tile = (key: string, label: string, get: (w: WellRow) => number | null, unit?: string, fmt = (v: number) => f.num(v)): Tile => {
    const v = lastNight ? get(lastNight) : null;
    const m = mean(history.map(get));
    const diff = v != null && m != null ? Math.round(v - m) : null;
    return {
      key,
      label,
      value: v == null ? "–" : fmt(v),
      unit,
      delta: diff == null ? undefined : diff === 0 ? "At your 28-day normal" : `${f.signed(diff)}${unit === "ms" ? " ms" : ""} vs your 28-day normal`,
      spark: spark(get),
      source: "Garmin",
    };
  };
  const tiles: Tile[] = [
    tile("hrv", "HRV", (w) => w.hrv_night_avg, "ms"),
    tile("rhr", "Resting HR", (w) => w.rhr, "bpm"),
    tile("sleep", "Sleep score", (w) => w.sleep_score),
    tile("bb", "Body Battery at wake", (w) => w.bb_wake),
    { ...tile("sleeptime", "Sleep time", (w) => w.sleep_s, undefined, (v) => f.hoursMinutes(v)), delta: undefined },
    tile("stress", "Stress", (w) => w.stress_avg),
  ];

  // Readiness: today's, or the latest available, with an explicit "as of".
  const ready = [...d.load].reverse().find((l) => l.readiness != null) ?? null;
  const band = ready?.readiness_parts?.band ? BAND[ready.readiness_parts.band] : null;
  const readyIsToday = ready?.date === d.today;
  const todayLoad = d.load.at(-1) ?? null;

  // Next A race and Garmin's predicted time for it.
  const nextRace = d.goals.races
    .filter((r) => r.date && r.date >= d.today)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1))[0];
  const daysTo = nextRace?.date ? Math.round((+new Date(`${nextRace.date}T00:00:00Z`) - +new Date(`${d.today}T00:00:00Z`)) / 86400e3) : null;
  const predicted = nextRace?.distance_m && nextRace.distance_m > 20000 ? d.prediction?.hm_s ?? null : null;
  const gap = predicted != null && nextRace?.goal_s ? predicted - nextRace.goal_s : null;
  const trend = predicted != null && d.predictionOld?.hm_s ? predicted - d.predictionOld.hm_s : null;

  // This week: plan from the template vs what was done.
  const week = DAYS.map((key, i) => {
    const date = addDays(d.monday, i);
    const done = d.week.filter((a) => a.start_local.slice(0, 10) === date);
    return { key, date, plan: d.template[key] ?? [], done, isToday: date === d.today, isFuture: date > d.today };
  });
  const todayPlan = week.find((w) => w.isToday)?.plan.map((p) => SESSION[p] ?? p) ?? [];
  // Legend lists only the sports that actually appear this week, in the fixed categorical order.
  const dotKey = (sp: string) => (sp === "run" || sp === "ride" || sp === "strength" ? sp : "other") as keyof typeof sportColor;
  const weekSports = (["run", "ride", "strength", "other"] as const).filter((k) => d.week.some((x) => dotKey(x.sport) === k));
  const LEGEND_NAME = { run: "run", ride: "ride", strength: "strength", other: "walk or other" } as const;

  const a = d.lastActivity;
  const pace = a?.avg_speed_mps && a.sport === "run" ? 1000 / a.avg_speed_mps : null;
  const routeLabel = a
    ? a.has_gps
      ? `Route of your last outdoor activity, ${a.name ?? "untitled"}`
      : `Heart-rate trace of ${a.name ?? "your last activity"}`
    : "";

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div className={`display ${s.wordmark}`}>PSYCHO</div>
        <p className={s.sync}>
          {d.device?.last_sync_at ? (
            <>
              Synced <time dateTime={d.device.last_sync_at}>{f.ago(d.device.last_sync_at)}</time>
            </>
          ) : (
            "Waiting for the first watch sync"
          )}
        </p>
      </header>

      <section className={s.hero} aria-labelledby="readiness">
        <div className={s.route} aria-hidden={!a}>
          {a ? <RouteLine route={a.has_gps ? d.chart?.route : null} hr={d.chart?.hr} label={routeLabel} /> : null}
        </div>
        <div className={s.heroText}>
          <h1 id="readiness" className="visually-hidden">
            Readiness
          </h1>
          {ready?.readiness != null ? (
            <>
              <p className={s.figure} aria-label={`Readiness ${ready.readiness}${band ? `, ${band.label}` : ""}`}>
                {ready.readiness}
              </p>
              {band ? (
                <p className={s.band}>
                  <StatusMark kind={band.kind} label={band.label} />
                  {!readyIsToday ? <span className={s.asOf}>as of {f.day(ready.date)}</span> : null}
                </p>
              ) : null}
              {ready.readiness_parts?.verdict ? <p className={s.verdict}>{ready.readiness_parts.verdict}</p> : null}
              {!readyIsToday ? (
                <p className={s.note}>Last night hasn&apos;t synced yet. Open Garmin Connect on your phone to sync your watch.</p>
              ) : null}
            </>
          ) : (
            <p className={s.verdict}>Readiness needs 14 days of sleep and HRV. It will appear here once your watch has that history.</p>
          )}
        </div>
      </section>

      <div className={s.grid}>
        <section className={`${s.band} ${s.overnight}`} aria-labelledby="overnight">
          <div className={s.sectionHead}>
            <h2 id="overnight" className={s.sectionTitle}>
              Overnight
            </h2>
            {nightDate && nightDate !== d.today ? <span className={s.asOf}>Night to {f.day(nightDate)}</span> : null}
          </div>
          <OvernightTiles tiles={tiles} className={s.tiles} />
        </section>

        <div className={s.side}>
          <section className={s.band} aria-labelledby="form">
            <h2 id="form" className={s.sectionTitle}>
              Form
            </h2>
            {todayLoad ? (
              <>
                <dl className={s.stats}>
                  <div>
                    <dt>Form</dt>
                    <dd>{f.signed(todayLoad.tsb)}</dd>
                  </div>
                  <div>
                    <dt>Fitness</dt>
                    <dd>{f.num(todayLoad.ctl)}</dd>
                  </div>
                  <div>
                    <dt>Fatigue</dt>
                    <dd>{f.num(todayLoad.atl)}</dd>
                  </div>
                </dl>
                <p className={s.meta}>
                  {todayLoad.psycho_status ? STATUS[todayLoad.psycho_status] : "No status yet"}
                  <span className={s.badge}>Psycho</span>
                </p>
                <FormStrip rows={d.load.slice(-28)} />
              </>
            ) : (
              <p className={s.meta}>Form appears after your first synced workout.</p>
            )}
          </section>

          {nextRace && daysTo != null ? (
            <section className={s.band} aria-labelledby="race">
              <h2 id="race" className={s.sectionTitle}>
                {nextRace.name}
              </h2>
              <p className={`display ${s.countdown}`}>
                {daysTo === 0 ? "Race day" : `${daysTo} ${daysTo === 1 ? "day" : "days"}`}
              </p>
              {predicted != null ? (
                <dl className={s.stats}>
                  <div>
                    <dt>Predicted</dt>
                    <dd>{f.duration(predicted)}</dd>
                  </div>
                  {nextRace.goal_s ? (
                    <div>
                      <dt>Goal</dt>
                      <dd>{f.duration(nextRace.goal_s)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {gap != null ? (
                <p className={s.meta}>
                  {gap <= 0 ? `${f.duration(-gap)} inside your goal` : `${f.duration(gap)} outside your goal`}
                  {trend != null && Math.abs(trend) >= 5 ? `, ${f.duration(Math.abs(trend))} ${trend < 0 ? "faster" : "slower"} than 4 weeks ago` : ""}.
                  <span className={s.badge}>Garmin</span>
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className={`${s.band} ${s.weekBand}`} aria-labelledby="week">
          <div className={s.sectionHead}>
            <h2 id="week" className={s.sectionTitle}>
              This week
            </h2>
            {todayPlan.length ? <span className={s.meta}>Today: {todayPlan.join(", ")}</span> : null}
          </div>
          <ol className={s.week}>
            {week.map((w, i) => {
              const plan = w.plan.map((p) => SESSION[p] ?? p);
              const done = w.done.map((x) => `${SPORT_NAME[x.sport]}${x.distance_m && x.distance_m > 500 ? ` ${f.num(x.distance_m / 1000, 1)} km` : ""}`);
              return (
                <li
                  key={w.key}
                  className={`${s.day} ${w.isToday ? s.today : ""}`}
                  aria-label={`${DAY_NAME[i]}. Planned: ${plan.join(", ") || "nothing"}. Done: ${done.join(", ") || (w.isFuture ? "not yet" : "nothing")}.`}
                >
                  <span className={s.dayName} aria-hidden>
                    {DAY_NAME[i]!.slice(0, 3)}
                  </span>
                  <span className={s.marks} aria-hidden>
                    {w.done.map((x) => (
                      <span key={x.id} className={s.done} style={{ background: sportColor[dotKey(x.sport)] }} />
                    ))}
                    {w.done.length === 0 && plan.length ? <span className={s.planned} /> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className={s.legendLine} aria-hidden>
            <span className={s.planned} /> planned
            {weekSports.map((k) => (
              <span key={k} className={s.legendItem}>
                <span className={s.done} style={{ background: sportColor[k] }} /> {LEGEND_NAME[k]}
              </span>
            ))}
          </p>
        </section>

        {a ? (
          <section className={`${s.band} ${s.last}`} aria-labelledby="last">
            <div className={s.sectionHead}>
              <h2 id="last" className={s.sectionTitle}>
                Last activity
              </h2>
              <span className={s.meta}>{f.day(a.start_local)}</span>
            </div>
            <Link href={`/activity/${a.id}`} className={s.activity}>
              <span className={s.activityName}>{a.name ?? SPORT_NAME[a.sport]}</span>
              <dl className={s.stats}>
                {a.distance_m && a.distance_m > 500 ? (
                  <div>
                    <dt>Distance</dt>
                    <dd>{f.num(a.distance_m / 1000, 1)} km</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Time</dt>
                  <dd>{f.duration(a.duration_s)}</dd>
                </div>
                {pace ? (
                  <div>
                    <dt>Pace</dt>
                    <dd>{f.pace(pace)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Load</dt>
                  <dd>{d.lastMetric?.hrtss != null ? f.num(d.lastMetric.hrtss) : "–"}</dd>
                </div>
                {a.aerobic_te != null ? (
                  <div>
                    <dt>Training effect</dt>
                    <dd>{f.num(a.aerobic_te, 1)}</dd>
                  </div>
                ) : null}
              </dl>
              <span className={s.open}>Open activity</span>
            </Link>
          </section>
        ) : null}

        {d.errors.length ? (
          <p className={`${s.band} ${s.full} ${s.meta}`} role="alert">
            Some data didn&apos;t load. Pull to refresh, or try again in a minute.
          </p>
        ) : null}
      </div>
    </main>
  );
}
