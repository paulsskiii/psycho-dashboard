"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { color, zones } from "@psycho/tokens";

import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { StatusMark } from "@/components/ui/StatusMark";
import type { IntensityActivity, IntensityData } from "@/lib/data/intensity";
import * as f from "@/lib/format";
import { weekKey } from "@/lib/weeks";

import s from "../analysis.module.css";

const TARGET = 80;
const SERIES = [
  { key: "low", label: "Low (Z1–2)", color: zones[0] },
  { key: "mod", label: "Moderate (Z3)", color: zones[2] },
  { key: "high", label: "High (Z4–5)", color: zones[4] },
] as const;

/** Seconds in low / moderate / high from Garmin's five zones (spec §8.6). */
function split(z: number[] | null) {
  if (!z || z.length < 5) return null;
  return { low: z[0]! + z[1]!, mod: z[2]!, high: z[3]! + z[4]! };
}

export function IntensityCharts({ data, days }: { data: IntensityData; days: number }) {
  const [mode, setMode] = useState<"share" | "hours">("share");
  const acts = data.activities;

  const weekly = useMemo(() => {
    const byWeek = new Map<string, { low: number; mod: number; high: number; n: number }>();
    for (const a of acts) {
      const z = split(a.zone_s);
      if (!z) continue;
      const k = weekKey(a.start_local);
      const w = byWeek.get(k) ?? { low: 0, mod: 0, high: 0, n: 0 };
      w.low += z.low;
      w.mod += z.mod;
      w.high += z.high;
      w.n += 1;
      byWeek.set(k, w);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, w]) => {
        const total = w.low + w.mod + w.high;
        return { week: k, ...w, total, lowPct: total ? (w.low / total) * 100 : 0 };
      })
      .filter((w) => w.total > 0);
  }, [acts]);

  const drifted = acts.filter((a) => a.drifted_hard).reverse();

  if (!weekly.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>No runs or rides with heart-rate zones in this range yet. Your next run will show up here after it syncs.</p>
      </section>
    );
  }

  const sum = weekly.reduce((a, w) => ({ low: a.low + w.low, mod: a.mod + w.mod, high: a.high + w.high }), { low: 0, mod: 0, high: 0 });
  const total = sum.low + sum.mod + sum.high;
  const lowShare = (sum.low / total) * 100;
  const onTarget = weekly.filter((w) => w.lowPct >= TARGET).length;
  const pct = (v: number) => Math.round((v / total) * 1000) / 10;

  const bars: BarDatum[] = weekly.map((w) => ({
    key: w.week,
    label: f.dayShort(w.week),
    title: `Week of ${f.day(w.week)} · ${w.n} ${w.n === 1 ? "session" : "sessions"}`,
    values:
      mode === "share"
        ? { low: (w.low / w.total) * 100, mod: (w.mod / w.total) * 100, high: (w.high / w.total) * 100 }
        : { low: w.low / 3600, mod: w.mod / 3600, high: w.high / 3600 },
  }));
  const tickEvery = weekly.length > 16 ? Math.ceil(weekly.length / 8) : weekly.length > 8 ? 2 : 1;

  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <dl className={s.stats}>
          <div>
            <dt>Low-intensity share</dt>
            <dd>{f.num(lowShare)} %</dd>
          </div>
          <div>
            <dt>Weeks on 80/20</dt>
            <dd>
              {onTarget} of {weekly.length}
            </dd>
          </div>
          <div>
            <dt>Easy runs that drifted hard</dt>
            <dd>{drifted.length}</dd>
          </div>
        </dl>
        <p className={s.note}>
          <StatusMark kind={lowShare >= TARGET ? "good" : "warning"} label={lowShare >= TARGET ? "On target" : `${f.num(TARGET - lowShare)} points under the 80 % target.`} />
          {lowShare < TARGET ? " Most of your easy time is landing in zone 3 and above. Slow the easy runs down until your heart rate stays in zone 2." : null}
        </p>
      </section>

      <section className={`${s.band} ${s.wide}`}>
        <div className={s.seg} role="group" aria-label="Show as">
          <button type="button" aria-pressed={mode === "share"} onClick={() => setMode("share")}>
            Share
          </button>
          <button type="button" aria-pressed={mode === "hours"} onClick={() => setMode("hours")}>
            Hours
          </button>
        </div>
        <ChartFrame
          title="Weekly intensity"
          description={`Run and ride time by heart-rate zone, from Garmin's zones. Target: ${TARGET} % low.`}
          legend={[...SERIES.map((sr) => ({ label: sr.label, color: sr.color })), ...(mode === "share" ? [{ label: `${TARGET} % low target`, color: color.ink, kind: "line" as const }] : [])]}
          table={{
            columns: ["Week", "Sessions", "Low", "Moderate", "High", "Low %"],
            rows: weekly.map((w) => [f.day(w.week), w.n, f.hoursMinutes(w.low), f.hoursMinutes(w.mod), f.hoursMinutes(w.high), `${f.num(w.lowPct)} %`]),
          }}
        >
          <BarChart
            ariaLabel={`Weekly intensity distribution, last ${days} days`}
            data={bars}
            series={SERIES.map((sr) => ({ ...sr }))}
            yTick={mode === "share" ? (v) => `${f.num(v)} %` : (v) => `${f.num(v, v < 2 && v % 1 ? 1 : 0)} h`}
            yMax={mode === "share" ? 100 : undefined}
            target={mode === "share" ? { value: TARGET, label: `${TARGET} % low` } : undefined}
            tickEvery={tickEvery}
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.narrow}`}>
        <ChartFrame
          title="Time in range"
          description="All run and ride time in the range."
          table={{ columns: ["Zone", "Time", "Share"], rows: SERIES.map((sr) => [sr.label, f.hoursMinutes(sum[sr.key]), `${pct(sum[sr.key])} %`]) }}
        >
          <ul className={s.list}>
            {SERIES.map((sr) => (
              <li key={sr.key} className={s.item}>
                <span className={s.itemMain}>
                  <span className={s.itemName}>
                    <span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: sr.color, marginRight: 8 }} />
                    {sr.label}
                  </span>
                </span>
                <span className={s.itemValue}>
                  {pct(sum[sr.key])} %<small>{f.hoursMinutes(sum[sr.key])}</small>
                </span>
              </li>
            ))}
          </ul>
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Easy runs that drifted hard"
          description="Runs with no structured workout that spent 30 % or more of their time in zone 3 and above."
          table={{
            columns: ["Date", "Run", "Time", "Avg HR", "Zone 3+"],
            rows: drifted.map((a) => [f.day(a.start_local), a.name ?? "Run", f.duration(a.duration_s), a.avg_hr ? `${a.avg_hr} bpm` : "–", `${f.num(z3plus(a))} %`]),
          }}
        >
          {drifted.length ? (
            <ul className={s.list}>
              {drifted.map((a) => (
                <li key={a.id}>
                  <Link className={s.item} href={`/activity/${a.id}`} prefetch={false}>
                    <span className={s.itemMain}>
                      <span className={s.itemName}>{a.name ?? "Run"}</span>
                      <span className={s.itemMeta}>
                        {f.day(a.start_local)} · {a.distance_m ? `${f.num(a.distance_m / 1000, 1)} km · ` : ""}
                        {f.duration(a.duration_s)}
                        {a.avg_hr ? ` · ${a.avg_hr} bpm` : ""}
                      </span>
                    </span>
                    <span className={s.itemValue}>
                      {f.num(z3plus(a))} %<small>zone 3+</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.empty}>None in this range. Your easy runs stayed easy.</p>
          )}
        </ChartFrame>
      </section>
    </div>
  );
}

function z3plus(a: IntensityActivity) {
  return (a.mod_pct ?? 0) + (a.high_pct ?? 0);
}
