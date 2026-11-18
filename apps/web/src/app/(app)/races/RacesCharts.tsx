"use client";

import Link from "next/link";

import { sport } from "@psycho/tokens";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart } from "@/components/charts/LineChart";
import { SmallMultiples } from "@/components/charts/SmallMultiples";
import type { Effort, Prediction, RacesData } from "@/lib/data/races";
import type { Race } from "@/lib/data/today";
import * as f from "@/lib/format";

import s from "../analysis.module.css";
import r from "./races.module.css";

const ms = (d: string) => +f.toDate(d);
const RIEGEL = 1.06;
const DISTANCES = [
  { key: "k5_s", label: "5K", m: 5000 },
  { key: "k10_s", label: "10K", m: 10000 },
  { key: "hm_s", label: "Half marathon", m: 21097.5 },
  { key: "m_s", label: "Marathon", m: 42195 },
] as const;
const PB_ORDER: { type: string; label: string; distance?: boolean }[] = [
  { type: "run_1k", label: "1 km" },
  { type: "run_1mi", label: "1 mile" },
  { type: "run_5k", label: "5K" },
  { type: "run_10k", label: "10K" },
  { type: "run_hm", label: "Half marathon" },
  { type: "run_m", label: "Marathon" },
  { type: "run_longest", label: "Longest run", distance: true },
];

/** Garmin's predicted time for a race distance, or null when it isn't one of the four. */
function garminFor(p: Prediction | null, distance: number | null) {
  if (!p || !distance) return null;
  const d = DISTANCES.find((x) => Math.abs(x.m - distance) / x.m < 0.03);
  return d ? p[d.key] : null;
}

/** Fastest Riegel projection over the efforts (spec §8.7), with the run it came from. */
function bestRiegel(efforts: Effort[], target: number) {
  let best: { s: number; from: Effort } | null = null;
  for (const e of efforts) {
    const t = e.time_s * (target / e.distance_m) ** RIEGEL;
    if (!best || t < best.s) best = { s: t, from: e };
  }
  return best;
}

const gapText = (gap: number) => (gap <= 0 ? `${f.duration(-gap)} inside` : `${f.duration(gap)} outside`);
const daysBetween = (a: string, b: string) => Math.round((+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / 86400e3);

export function RacesCharts({ data, days }: { data: RacesData; days: number }) {
  const preds = data.predictions;
  const latest = preds.at(-1) ?? null;
  const upcoming = data.goals.races
    .filter((x) => x.date && x.date >= data.today)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const next = upcoming.find((x) => x.priority === "A") ?? upcoming[0] ?? null;

  return (
    <div className={s.grid}>
      {next ? <Hero race={next} data={data} latest={latest} /> : (
        <section className={`${s.band} ${s.full}`}>
          <p className={s.empty}>No upcoming race with a date. Add one in Settings to see the countdown and your goal gap.</p>
        </section>
      )}

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Garmin race predictor"
          description="Garmin's predicted finish time for each distance. Faster is up."
          table={{
            columns: ["Date", ...DISTANCES.map((d) => d.label)],
            rows: preds.map((p) => [f.day(p.date), ...DISTANCES.map((d) => f.duration(p[d.key]))]),
          }}
        >
          {preds.length > 1 ? (
            <div className={r.quad}>
            <SmallMultiples>
              {DISTANCES.map((d) => (
                <div key={d.key} className={r.multiple}>
                  <div className={r.multipleTitle}>{d.label}</div>
                  <LineChart
                    ariaLabel={`Garmin predicted ${d.label} time, last ${days} days`}
                    height={150}
                    series={[{ key: d.key, label: d.label, color: sport.run, points: preds.map((p) => ({ x: ms(p.date), y: p[d.key] == null ? null : p[d.key]! / 60 })) }]}
                    invertY
                    xTick={f.dayShort}
                    yTick={(v) => f.duration(v * 60)}
                    tipTitle={f.day}
                    tipValue={(v) => f.duration(v * 60)}
                  />
                </div>
              ))}
            </SmallMultiples>
            </div>
          ) : (
            <p className={s.empty}>No race predictions in this range yet. They arrive with the nightly sync.</p>
          )}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Riegel projection"
          description="From your fastest outdoor run of 5 km or more in the last 60 days, using moving time. Shown beside Garmin's, never averaged with it."
          table={{
            columns: ["Distance", "Riegel", "Garmin", "From run"],
            rows: DISTANCES.map((d) => {
              const b = bestRiegel(data.efforts, d.m);
              return [d.label, b ? f.duration(b.s) : "–", f.duration(latest?.[d.key]), b ? `${b.from.name ?? "Run"}, ${f.day(b.from.start_local)}` : "–"];
            }),
          }}
        >
          {data.efforts.length ? (
            <ul className={s.list}>
              {DISTANCES.map((d) => {
                const b = bestRiegel(data.efforts, d.m);
                return (
                  <li key={d.key} className={s.item}>
                    <span className={s.itemMain}>
                      <span className={s.itemName}>{d.label}</span>
                      <span className={s.itemMeta}>Garmin {f.duration(latest?.[d.key])}</span>
                    </span>
                    <span className={s.itemValue}>
                      {b ? f.duration(b.s) : "–"}
                      <small>Riegel</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={s.empty}>No outdoor run of 5 km or more in the last 60 days.</p>
          )}
          {data.efforts.length ? (
            (() => {
              const b = bestRiegel(data.efforts, 21097.5)!;
              return (
                <p className={s.note}>
                  Based on{" "}
                  <Link href={`/activity/${b.from.id}`} prefetch={false} className={r.link}>
                    {b.from.name ?? "Run"}, {f.day(b.from.start_local)}
                  </Link>{" "}
                  ({f.num(b.from.distance_m / 1000, 1)} km in {f.duration(b.from.time_s)}). Training runs aren&apos;t all-out, so this reads slow until you race.
                </p>
              );
            })()
          ) : null}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Personal bests"
          description="Garmin's records from your watch."
          table={{
            columns: ["Distance", "Best", "Date"],
            rows: PB_ORDER.flatMap((p) => {
              const rec = data.records.find((x) => x.type === p.type);
              return rec ? [[p.label, p.distance ? `${f.num(rec.value / 1000, 2)} km` : f.duration(rec.value), rec.achieved_on ? f.day(rec.achieved_on) : "–"]] : [];
            }),
          }}
        >
          <ul className={s.list}>
            {PB_ORDER.map((p) => {
              const rec = data.records.find((x) => x.type === p.type);
              if (!rec) return null;
              const body = (
                <>
                  <span className={s.itemMain}>
                    <span className={s.itemName}>{p.label}</span>
                    <span className={s.itemMeta}>{rec.achieved_on ? f.day(rec.achieved_on) : ""}</span>
                  </span>
                  <span className={s.itemValue}>
                    {p.distance ? `${f.num(rec.value / 1000, 2)} km` : f.duration(rec.value)}
                    {!p.distance ? <small>{f.pace(rec.value / ((DISTANCES.find((d) => d.label === p.label)?.m ?? (p.type === "run_1k" ? 1000 : 1609.34)) / 1000))}</small> : null}
                  </span>
                </>
              );
              return (
                <li key={p.type}>
                  {rec.activity_id ? (
                    <Link className={s.item} href={`/activity/${rec.activity_id}`} prefetch={false}>
                      {body}
                    </Link>
                  ) : (
                    <div className={s.item}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Races and goals"
          table={{
            columns: ["Race", "Date", "Distance", "Priority", "Goal"],
            rows: [
              ...data.goals.races.map((x) => [x.name, x.date ? f.day(x.date) : "Date not set", x.distance_m ? `${f.num(x.distance_m / 1000, 1)} km` : "–", x.priority, x.goal_s ? f.duration(x.goal_s) : "–"]),
              ...(data.goals.long_term ?? []).map((g) => [g.label, "Long term", "–", "–", g.goal_s ? f.duration(g.goal_s) : "–"]),
            ],
          }}
        >
          <ul className={s.list}>
            {data.goals.races.map((x) => (
              <li key={`${x.name}-${x.date}`} className={s.item}>
                <span className={s.itemMain}>
                  <span className={s.itemName}>{x.name}</span>
                  <span className={s.itemMeta}>
                    {[x.date ? f.day(x.date) : "Date not set", x.distance_m ? `${f.num(x.distance_m / 1000, 1)} km` : null, `${x.priority} race`, x.date && x.date < data.today ? "done" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className={s.itemValue}>
                  {x.goal_s ? f.duration(x.goal_s) : "–"}
                  <small>{x.goal_s ? "goal" : "no goal set"}</small>
                </span>
              </li>
            ))}
            {(data.goals.long_term ?? []).map((g) => (
              <li key={g.label} className={s.item}>
                <span className={s.itemMain}>
                  <span className={s.itemName}>{g.label}</span>
                  <span className={s.itemMeta}>Long-term goal</span>
                </span>
                <span className={s.itemValue}>
                  {g.goal_s ? f.duration(g.goal_s) : "–"}
                  <small>goal</small>
                </span>
              </li>
            ))}
          </ul>
        </ChartFrame>
      </section>
    </div>
  );
}

function Hero({ race, data, latest }: { race: Race; data: RacesData; latest: Prediction | null }) {
  const daysTo = daysBetween(data.today, race.date!);
  const garmin = garminFor(latest, race.distance_m);
  const before = garminFor(data.prior, race.distance_m);
  const riegel = race.distance_m ? bestRiegel(data.efforts, race.distance_m) : null;
  const km = race.distance_m ? race.distance_m / 1000 : null;
  const gap = garmin != null && race.goal_s ? garmin - race.goal_s : null;
  const trend = garmin != null && before != null ? garmin - before : null;
  return (
    <section className={`${s.band} ${s.full}`} aria-labelledby="next-race">
      <div className={r.hero}>
        <div>
          <h2 id="next-race" className={r.raceName}>
            {race.name}
          </h2>
          <p className={r.raceMeta}>
            {f.day(race.date!)}
            {km ? ` · ${f.num(km, 1)} km` : ""} · {race.priority} race
          </p>
          <p className={`display ${r.countdown}`}>{daysTo === 0 ? "Race day" : `${daysTo} ${daysTo === 1 ? "day" : "days"}`}</p>
        </div>
        <dl className={s.stats}>
          {race.goal_s ? (
            <div>
              <dt>Goal</dt>
              <dd>{f.duration(race.goal_s)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Garmin predicts</dt>
            <dd>{f.duration(garmin)}</dd>
          </div>
          <div>
            <dt>Riegel projects</dt>
            <dd>{f.duration(riegel?.s)}</dd>
          </div>
        </dl>
      </div>
      {gap != null && km ? (
        <p className={s.note}>
          Garmin&apos;s prediction is {gapText(gap)} your goal ({f.signed(gap / km, 0)} s/km
          {race.goal_s ? `; goal pace ${f.pace(race.goal_s / km)}` : ""})
          {trend != null && Math.abs(trend) >= 5 ? `, ${f.duration(Math.abs(trend))} ${trend < 0 ? "faster" : "slower"} than 4 weeks ago` : ", about the same as 4 weeks ago"}.
          {daysTo <= 7 ? " Race week: keep it easy and sleep." : ""}
        </p>
      ) : null}
    </section>
  );
}
