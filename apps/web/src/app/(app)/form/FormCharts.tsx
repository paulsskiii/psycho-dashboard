"use client";

import { useMemo, useState } from "react";

import { sport } from "@psycho/tokens";

import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { DivergingBars } from "@/components/charts/DivergingBars";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { LineChart } from "@/components/charts/LineChart";
import { Meter } from "@/components/charts/Meter";
import { STATUS_META, StatusTimeline, type StatusKey } from "@/components/charts/StatusTimeline";
import { StatusMark } from "@/components/ui/StatusMark";
import type { FormData } from "@/lib/data/form";
import * as f from "@/lib/format";
import { weekKey } from "@/lib/weeks";

import s from "../analysis.module.css";

const ms = (d: string) => +f.toDate(d);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function acwrBand(v: number | null) {
  if (v == null) return "Not enough history yet";
  if (v < 0.8) return "Under-loading";
  if (v <= 1.3) return "In the sweet spot";
  if (v <= 1.5) return "Caution";
  return "High spike";
}

export function FormCharts({ data, days }: { data: FormData; days: number }) {
  const [withStrength, setWithStrength] = useState(true);
  const load = data.load;
  const today = load.at(-1) ?? null;
  const warmEnd = load.filter((l) => l.warming_up).at(-1);
  const tickEvery = days > 60 ? Math.ceil(days / 8) : 7;

  const weeks = useMemo(() => {
    const byWeek = new Map<string, { run: number; ride: number; strength: number }>();
    for (const l of load) {
      const k = weekKey(l.date);
      const w = byWeek.get(k) ?? { run: 0, ride: 0, strength: 0 };
      w.run += l.tss_run;
      w.ride += l.tss_ride;
      w.strength += l.tss_strength;
      byWeek.set(k, w);
    }
    const te = new Map<string, { a: number[]; b: number[] }>();
    for (const a of data.activities) {
      const k = weekKey(a.start_local);
      const w = te.get(k) ?? { a: [], b: [] };
      if (a.aerobic_te != null) w.a.push(a.aerobic_te);
      if (a.anaerobic_te != null) w.b.push(a.anaerobic_te);
      te.set(k, w);
    }
    const keys = [...byWeek.keys()].sort();
    const loadData: BarDatum[] = keys.map((k) => {
      const w = byWeek.get(k)!;
      return {
        key: k,
        label: f.dayShort(k),
        title: `Week of ${f.day(k)}`,
        values: { run: Math.round(w.run), ride: Math.round(w.ride), ...(withStrength ? { strength: Math.round(w.strength) } : {}) },
      };
    });
    const teData = [...te.keys()].sort().map((k) => {
      const w = te.get(k)!;
      return { key: k, label: f.dayShort(k), title: `Week of ${f.day(k)}`, a: avg(w.a), b: avg(w.b) };
    });
    return { loadData, teData };
  }, [load, data.activities, withStrength]);

  if (!load.length) {
    return (
      <section className={`${s.band}`}>
        <p className={s.empty}>No training load in this range yet. Your first synced workout will show up here.</p>
      </section>
    );
  }

  const st = today?.psycho_status as StatusKey | null;
  const loadSeries = [
    { key: "run", label: "Run", color: sport.run },
    { key: "ride", label: "Ride", color: sport.ride },
    ...(withStrength ? [{ key: "strength", label: "Strength", color: sport.strength }] : []),
  ];

  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.wide}`}>
        <ChartFrame
          title="Fitness and fatigue"
          description="Fitness is your 42-day training load, fatigue your 7-day load, both from hrTSS."
          legend={[
            { label: "Fitness", color: sport.run, kind: "line" },
            { label: "Fatigue", color: sport.ride, kind: "line" },
          ]}
          table={{ columns: ["Date", "Fitness", "Fatigue"], rows: load.map((l) => [f.day(l.date), f.num(l.ctl, 1), f.num(l.atl, 1)]) }}
        >
          <LineChart
            ariaLabel={`Fitness and fatigue, last ${days} days`}
            series={[
              { key: "ctl", label: "Fitness", color: sport.run, points: load.map((l) => ({ x: ms(l.date), y: l.ctl })) },
              { key: "atl", label: "Fatigue", color: sport.ride, points: load.map((l) => ({ x: ms(l.date), y: l.atl })) },
            ]}
            xTick={f.dayShort}
            yTick={(v) => f.num(v)}
            tipTitle={f.day}
            tipValue={(v) => f.num(v, 1)}
            includeZero
            dimUntil={warmEnd ? ms(warmEnd.date) : undefined}
            dimLabel="Warming up: under 42 days of history"
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.narrow}`}>
        <ChartFrame
          title="Acute:chronic ratio"
          description="Your 7-day load against your 28-day load. A guide, not a rule: the research behind it is contested."
          table={{ columns: ["Date", "Ratio", "7-day ramp"], rows: load.slice(-14).map((l) => [f.day(l.date), f.num(l.acwr, 2), f.signed(l.ramp_7d, 1)]) }}
        >
          <Meter
            label="Acute to chronic workload ratio"
            value={today?.acwr ?? null}
            domain={[0, 2]}
            bands={[
              { from: 0, to: 0.8, label: "Under-loading" },
              { from: 0.8, to: 1.3, label: "Sweet spot" },
              { from: 1.3, to: 1.5, label: "Caution" },
              { from: 1.5, to: 2, label: "Spike" },
            ]}
            valueText={f.num(today?.acwr ?? null, 2)}
            bandText={acwrBand(today?.acwr ?? null)}
          />
        </ChartFrame>
        <dl className={s.stats}>
          <div>
            <dt>7-day ramp</dt>
            <dd>{f.signed(today?.ramp_7d ?? null, 1)}</dd>
          </div>
          {st && STATUS_META[st] ? (
            <div>
              <dt>Status</dt>
              <dd style={{ fontSize: "var(--fs-body)", paddingTop: 6 }}>
                <StatusMark kind={STATUS_META[st].kind} label={STATUS_META[st].label} />
              </dd>
            </div>
          ) : null}
        </dl>
        <p className={s.note}>Ramp is how much your fitness rose over the last 7 days.</p>
      </section>

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Form"
          description="Form (TSB) going into each day: yesterday's fitness minus yesterday's fatigue."
          table={{ columns: ["Date", "Form"], rows: load.map((l) => [f.day(l.date), f.signed(l.tsb, 1)]) }}
        >
          <DivergingBars
            ariaLabel={`Form, last ${days} days`}
            data={load.map((l) => ({ key: l.date, label: f.dayShort(l.date), title: f.day(l.date), value: l.tsb, dim: l.warming_up }))}
            yTick={(v) => f.signed(v)}
            tickEvery={tickEvery}
            negLabel="Fatigued"
            posLabel="Fresh"
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Weekly load by sport"
          legend={loadSeries.map((x) => ({ label: x.label, color: x.color }))}
          table={{
            columns: ["Week", ...loadSeries.map((x) => x.label)],
            rows: weeks.loadData.map((d) => [d.title, ...loadSeries.map((x) => d.values[x.key] ?? 0)]),
          }}
        >
          <BarChart ariaLabel="Weekly hrTSS by sport" data={weeks.loadData} series={loadSeries} yTick={(v) => f.num(v)} />
        </ChartFrame>
        <label className={s.toggleRow}>
          <input type="checkbox" checked={withStrength} onChange={(e) => setWithStrength(e.target.checked)} />
          Include strength (heart-rate load under-reads lifting)
        </label>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Training Effect by week"
          description="Average aerobic and anaerobic Training Effect of your sessions each week, 0–5."
          legend={[
            { label: "Aerobic", color: sport.run },
            { label: "Anaerobic", color: sport.ride },
          ]}
          table={{ columns: ["Week", "Aerobic", "Anaerobic"], rows: weeks.teData.map((d) => [d.title, f.num(d.a, 1), f.num(d.b, 1)]) }}
        >
          <Dumbbell
            ariaLabel="Weekly average Training Effect, aerobic and anaerobic"
            data={weeks.teData}
            a={{ label: "Aerobic", color: sport.run }}
            b={{ label: "Anaerobic", color: sport.ride }}
            yDomain={[0, 5]}
            yTick={(v) => f.num(v, 1)}
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Training status"
          description="Psycho's estimate from your load, form and VO2 max or efficiency trend."
          table={{ columns: ["Date", "Status"], rows: load.map((l) => [f.day(l.date), STATUS_META[l.psycho_status as StatusKey]?.label ?? "–"]) }}
        >
          <StatusTimeline rows={load.map((l) => ({ date: l.date, status: l.psycho_status }))} />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="VO2 max"
          description="Garmin's running VO2 max estimate."
          table={{ columns: ["Date", "VO2 max"], rows: data.vo2.map((v) => [f.day(v.date), f.num(v.vo2max, 1)]) }}
        >
          {data.vo2.length > 1 ? (
            <LineChart
              ariaLabel={`VO2 max, last ${days} days`}
              series={[{ key: "vo2", label: "VO2 max", color: sport.run, points: data.vo2.map((v) => ({ x: ms(v.date), y: v.vo2max })) }]}
              xTick={f.dayShort}
              yTick={(v) => f.num(v)}
              tipTitle={f.day}
              tipValue={(v) => f.num(v, 1)}
              wash
            />
          ) : (
            <p className={s.empty}>Not enough VO2 max readings in this range. Garmin updates it after outdoor runs with GPS.</p>
          )}
        </ChartFrame>
      </section>
    </div>
  );
}
