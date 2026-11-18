"use client";

import { scaleQuantize } from "d3-scale";
import { useMemo, useState } from "react";

import { color, sport, zones } from "@psycho/tokens";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart } from "@/components/charts/LineChart";
import { Scatter, type Dot } from "@/components/charts/Scatter";
import type { EfficiencyData, EfficiencyRun } from "@/lib/data/efficiency";
import * as f from "@/lib/format";
import { weekKey } from "@/lib/weeks";

import s from "../analysis.module.css";

const ms = (d: string) => +f.toDate(d.length > 10 ? `${d}+08:00` : d);
const ef2 = (v: number) => f.num(v, 2);
const DAY = 86400e3;

function median(xs: number[]) {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Why a run sits out of the trend lines (spec §8.6): hills and treadmill pace distort EF. */
function excluded(r: EfficiencyRun) {
  return r.indoor ? "Treadmill" : r.hilly ? "Hilly" : null;
}

function runMeta(r: EfficiencyRun) {
  return [r.distance_m ? `${f.num(r.distance_m / 1000, 1)} km` : null, f.duration(r.duration_s), r.temp_c != null ? `${f.num(r.temp_c)} °C` : null, excluded(r)]
    .filter(Boolean)
    .join(" · ");
}

export function EfficiencyCharts({ data, days }: { data: EfficiencyData; days: number }) {
  const [includeAll, setIncludeAll] = useState(false);
  const runs = data.runs;
  const counted = useMemo(() => runs.filter((r) => includeAll || !excluded(r)), [runs, includeAll]);

  const temps = runs.filter((r) => !r.indoor && r.temp_c != null).map((r) => r.temp_c!);
  const tLo = Math.floor(Math.min(...temps, 99));
  const tHi = Math.ceil(Math.max(...temps, -99));
  const tempColor = useMemo(() => scaleQuantize<string>().domain([tLo, tHi > tLo ? tHi : tLo + 1]).range([...zones]), [tLo, tHi]);
  const dotColor = (r: EfficiencyRun) => (r.temp_c != null && !r.indoor ? tempColor(r.temp_c) : color["ink-2"]);

  // Trend: mean EF of counted runs in the trailing 28 days, at each counted run.
  const trend = useMemo(
    () =>
      counted.map((r) => {
        const t = ms(r.start_local);
        const w = counted.filter((q) => ms(q.start_local) <= t && ms(q.start_local) > t - 28 * DAY).map((q) => q.ef!);
        return { x: t, y: w.length >= 2 ? w.reduce((a, b) => a + b, 0) / w.length : null };
      }),
    [counted],
  );

  const weeklyPace = useMemo(() => {
    const byWeek = new Map<string, number[]>();
    for (const r of counted) {
      if (r.pace_at_hr_s_per_km == null) continue;
      const k = weekKey(r.start_local);
      byWeek.set(k, [...(byWeek.get(k) ?? []), r.pace_at_hr_s_per_km]);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ week: k, pace: median(v)!, n: v.length }));
  }, [counted]);

  const longRuns = runs.filter((r) => r.decoupling_pct != null);

  if (!runs.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>No runs of 30 minutes or more in this range yet. Efficiency needs a steady run of at least 30 minutes with heart rate.</p>
      </section>
    );
  }

  const efDots: Dot[] = runs.map((r) => ({
    key: String(r.id),
    x: ms(r.start_local),
    y: r.ef!,
    color: dotColor(r),
    muted: !includeAll && Boolean(excluded(r)),
    title: `${r.name ?? "Run"} · ${f.day(r.start_local)}`,
    rows: [{ value: `EF ${ef2(r.ef!)}` }, { value: runMeta(r) }],
  }));
  const outdoor = counted.filter((r) => r.temp_c != null && !r.indoor);
  const nExcluded = runs.filter((r) => excluded(r)).length;
  const lastTrend = [...trend].reverse().find((p) => p.y != null)?.y ?? null;
  const firstTrend = trend.find((p) => p.y != null)?.y ?? null;
  const durable = longRuns.filter((r) => r.decoupling_pct! < 5).length;

  const tempLegend = temps.length ? (
    <div className={s.ramp}>
      <span>Air temperature {tLo} °C</span>
      <span aria-hidden style={{ background: `linear-gradient(90deg, ${zones.map((c, i) => `${c} ${i * 20}% ${(i + 1) * 20}%`).join(", ")})` }} />
      <span>{tHi} °C</span>
    </div>
  ) : null;

  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <dl className={s.stats}>
          <div>
            <dt>Efficiency factor, 28-day</dt>
            <dd>{lastTrend != null ? ef2(lastTrend) : "–"}</dd>
          </div>
          <div>
            <dt>Change over the range</dt>
            <dd>{lastTrend != null && firstTrend != null ? `${f.signed(((lastTrend - firstTrend) / firstTrend) * 100, 1)} %` : "–"}</dd>
          </div>
          <div>
            <dt>Durable long runs</dt>
            <dd>{longRuns.length ? `${durable} of ${longRuns.length}` : "–"}</dd>
          </div>
        </dl>
        <p className={s.note}>
          Efficiency factor is metres per minute for each heartbeat, after the first 10 minutes. Higher means you run faster for the same effort. Heat pushes your heart rate up, so a hot morning lowers it.
        </p>
        {nExcluded ? (
          <label className={s.toggleRow}>
            <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
            Include {nExcluded} hilly or treadmill {nExcluded === 1 ? "run" : "runs"} in the trends
          </label>
        ) : null}
      </section>

      <section className={`${s.band} ${s.wide}`}>
        <ChartFrame
          title="Efficiency factor"
          description="Each dot is a run of 30 minutes or more, coloured by air temperature. The line is your 28-day average."
          legend={[{ label: "28-day average", color: sport.run, kind: "line" }, ...(nExcluded && !includeAll ? [{ label: "Hilly or treadmill", color: color["ink-4"] }] : []), ...(runs.some((r) => !r.indoor && r.temp_c == null) ? [{ label: "No weather", color: color["ink-2"] }] : [])]}
          table={{
            columns: ["Date", "Run", "EF", "28-day avg", "Temp", "Note"],
            rows: runs.map((r) => {
              const i = counted.indexOf(r);
              return [f.day(r.start_local), r.name ?? "Run", ef2(r.ef!), i >= 0 && trend[i]?.y != null ? ef2(trend[i]!.y!) : "–", r.temp_c != null ? `${f.num(r.temp_c)} °C` : "–", excluded(r) ?? ""];
            }),
          }}
        >
          <Scatter
            ariaLabel={`Efficiency factor per run, last ${days} days`}
            dots={efDots}
            trend={{ label: "28-day average", color: sport.run, points: trend }}
            xTick={f.dayShort}
            yTick={ef2}
          />
          {tempLegend}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.narrow}`}>
        <ChartFrame
          title="Efficiency and heat"
          description="Outdoor runs only. A downward slope means heat is costing you."
          table={{ columns: ["Temp", "EF", "Date"], rows: [...outdoor].sort((a, b) => a.temp_c! - b.temp_c!).map((r) => [`${f.num(r.temp_c)} °C`, ef2(r.ef!), f.day(r.start_local)]) }}
        >
          {outdoor.length > 2 ? (
            <Scatter
              ariaLabel="Efficiency factor against air temperature"
              xKind="linear"
              dots={outdoor.map((r) => ({
                key: String(r.id),
                x: r.temp_c!,
                y: r.ef!,
                color: tempColor(r.temp_c!),
                title: `${r.name ?? "Run"} · ${f.day(r.start_local)}`,
                rows: [{ value: `EF ${ef2(r.ef!)}` }, { value: runMeta(r) }],
              }))}
              xTick={(v) => `${f.num(v)} °C`}
              yTick={ef2}
            />
          ) : (
            <p className={s.empty}>Needs at least three outdoor runs with weather.</p>
          )}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Aerobic decoupling"
          description="How much your efficiency fades from the first half to the second on steady runs of 45 minutes or more. Under 5 % means durable."
          table={{ columns: ["Date", "Run", "Decoupling", "Distance"], rows: longRuns.map((r) => [f.day(r.start_local), r.name ?? "Run", `${f.num(r.decoupling_pct, 1)} %`, r.distance_m ? `${f.num(r.distance_m / 1000, 1)} km` : "–"]) }}
        >
          {longRuns.length ? (
            <Scatter
              ariaLabel={`Aerobic decoupling per long run, last ${days} days`}
              dots={longRuns.map((r) => ({
                key: String(r.id),
                x: ms(r.start_local),
                y: r.decoupling_pct!,
                color: sport.run,
                title: `${r.name ?? "Run"} · ${f.day(r.start_local)}`,
                rows: [{ value: `${f.num(r.decoupling_pct, 1)} %`, name: r.decoupling_pct! < 5 ? "durable" : "faded" }, { value: runMeta(r) }],
              }))}
              refLine={{ value: 5, label: "5 %" }}
              xTick={f.dayShort}
              yTick={(v) => `${f.num(v)} %`}
            />
          ) : (
            <p className={s.empty}>No steady runs of 45 minutes or more in this range. Run a long easy run at an even pace to see it here.</p>
          )}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Pace at fixed heart rate"
          description={`Weekly median pace while your heart rate sits in ${data.band ? `${data.band[0]}–${data.band[1]} bpm` : "the upper half of zone 2"}. Faster is up.`}
          table={{ columns: ["Week", "Pace", "Runs"], rows: weeklyPace.map((w) => [f.day(w.week), f.pace(w.pace), w.n]) }}
        >
          {weeklyPace.length > 1 ? (
            <LineChart
              ariaLabel={`Weekly pace at fixed heart rate, last ${days} days`}
              height={200}
              series={[{ key: "pace", label: "Pace", color: sport.run, points: weeklyPace.map((w) => ({ x: ms(w.week), y: w.pace })) }]}
              invertY
              xTick={f.dayShort}
              yTick={f.paceShort}
              tipTitle={(x) => `Week of ${f.day(x)}`}
              tipValue={f.pace}
            />
          ) : (
            <p className={s.empty}>Needs runs from at least two weeks with 8 minutes or more inside the band.</p>
          )}
        </ChartFrame>
      </section>
    </div>
  );
}
