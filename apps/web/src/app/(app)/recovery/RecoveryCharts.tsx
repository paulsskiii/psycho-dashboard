"use client";

import { color, sleep as sleepColor, sport } from "@psycho/tokens";

import { BarChart } from "@/components/charts/BarChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart, type Point } from "@/components/charts/LineChart";
import { StatusMark, type StatusKind } from "@/components/ui/StatusMark";
import type { RecoveryData, RecoveryDay } from "@/lib/data/recovery";
import * as f from "@/lib/format";

import s from "../analysis.module.css";

const ms = (d: string) => +f.toDate(d);
const HRV_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  BALANCED: { label: "Balanced", kind: "good" },
  UNBALANCED: { label: "Unbalanced", kind: "warning" },
  LOW: { label: "Low", kind: "serious" },
  POOR: { label: "Poor", kind: "serious" },
};

function pts(rows: RecoveryDay[], get: (r: RecoveryDay) => number | null): Point[] {
  return rows.map((r) => ({ x: ms(r.date), y: get(r) }));
}

/** Trailing 7-day mean over days that have a value (needs ≥ 3 of the last 7). */
function rolling7(rows: RecoveryDay[], get: (r: RecoveryDay) => number | null): (number | null)[] {
  return rows.map((_, i) => {
    const w = rows.slice(Math.max(0, i - 6), i + 1).map(get).filter((v): v is number => v != null);
    return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

/** Daily values as quiet context (ink-4) under a 7-day average in colour — the line you read
 * (dataviz "emphasis": one hue, the rest grey). Table twin lists both. */
function Trend({
  title,
  description,
  rows,
  get,
  unit,
  digits = 0,
  days,
  empty,
}: {
  title: string;
  description?: string;
  rows: RecoveryDay[];
  get: (r: RecoveryDay) => number | null;
  unit: string;
  digits?: number;
  days: number;
  empty: string;
}) {
  const has = rows.filter((r) => get(r) != null).length;
  const fmt = (v: number) => `${f.num(v, digits)}${unit ? ` ${unit}` : ""}`;
  const avg = rolling7(rows, get);
  return (
    <ChartFrame
      title={title}
      description={description}
      legend={
        has > 1
          ? [
              { label: "7-day average", color: sport.run, kind: "line" },
              { label: "Daily", color: color["ink-4"], kind: "line" },
            ]
          : undefined
      }
      table={{
        columns: ["Date", title, "7-day average"],
        rows: rows.flatMap((r, i) => (get(r) == null ? [] : [[f.day(r.date), fmt(get(r)!), avg[i] == null ? "–" : fmt(avg[i]!)]])),
      }}
    >
      {has > 1 ? (
        <LineChart
          ariaLabel={`${title}, last ${days} days`}
          height={180}
          series={[
            { key: "avg", label: "7-day", color: sport.run, points: rows.map((r, i) => ({ x: ms(r.date), y: avg[i] ?? null })) },
            { key: "daily", label: "Daily", color: color["ink-4"], points: pts(rows, get) },
          ]}
          xTick={f.dayShort}
          yTick={(v) => f.num(v, digits)}
          tipTitle={f.day}
          tipValue={fmt}
        />
      ) : (
        <p className={s.empty}>{empty}</p>
      )}
    </ChartFrame>
  );
}

export function RecoveryCharts({ data, days }: { data: RecoveryData; days: number }) {
  const rows = data.days;
  if (!rows.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>No overnight data in this range yet. Wear your watch to sleep and it will show up here after it syncs.</p>
      </section>
    );
  }
  const lastHrv = [...rows].reverse().find((r) => r.hrv_night_avg != null);
  const hs = lastHrv?.hrv_status ? HRV_STATUS[lastHrv.hrv_status] : null;
  const nights = rows.filter((r) => r.sleep_s);
  const sleepEvery = nights.length > 45 ? 14 : 7;

  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Overnight HRV"
          description="Nightly average with your baseline band and 7-day average. Inside the band is normal for you."
          legend={[
            { label: "Nightly", color: sport.run, kind: "line" },
            { label: "7-day average", color: sport.ride, kind: "line" },
            { label: "Baseline", color: color["ink-4"] },
          ]}
          table={{
            columns: ["Date", "Nightly", "7-day avg", "Baseline", "Status"],
            rows: rows.map((r) => [
              f.day(r.date),
              f.num(r.hrv_night_avg),
              f.num(r.hrv_7d_avg),
              r.hrv_baseline_low != null ? `${r.hrv_baseline_low}–${r.hrv_baseline_high}` : "–",
              r.hrv_status ? (HRV_STATUS[r.hrv_status]?.label ?? r.hrv_status) : "–",
            ]),
          }}
        >
          <LineChart
            ariaLabel={`Overnight HRV, last ${days} days`}
            series={[
              { key: "night", label: "Nightly", color: sport.run, points: pts(rows, (r) => r.hrv_night_avg) },
              { key: "avg", label: "7-day", color: sport.ride, points: pts(rows, (r) => r.hrv_7d_avg) },
            ]}
            band={{ label: "Baseline", color: color["ink-4"], points: rows.map((r) => ({ x: ms(r.date), lo: r.hrv_baseline_low, hi: r.hrv_baseline_high })) }}
            xTick={f.dayShort}
            yTick={(v) => f.num(v)}
            tipTitle={f.day}
            tipValue={(v) => `${f.num(v)} ms`}
          />
        </ChartFrame>
        {hs && lastHrv ? (
          <p className={s.note}>
            <StatusMark kind={hs.kind} label={`HRV status ${hs.label.toLowerCase()}`} /> on the night to {f.day(lastHrv.date)}, from
            Garmin.
          </p>
        ) : null}
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Sleep stages"
          legend={[
            { label: "Deep", color: sleepColor.deep },
            { label: "Light", color: sleepColor.light },
            { label: "REM", color: sleepColor.rem },
            { label: "Awake", color: sleepColor.awake },
          ]}
          table={{
            columns: ["Night", "Total", "Deep", "Light", "REM", "Awake", "Score"],
            rows: nights.map((r) => [
              f.day(r.date),
              f.hoursMinutes(r.sleep_s),
              f.hoursMinutes(r.deep_s),
              f.hoursMinutes(r.light_s),
              f.hoursMinutes(r.rem_s),
              f.hoursMinutes(r.awake_s),
              f.num(r.sleep_score),
            ]),
          }}
        >
          <BarChart
            ariaLabel={`Sleep stages per night, last ${days} days`}
            data={nights.map((r) => ({
              key: r.date,
              label: f.dayShort(r.date),
              title: `Night to ${f.day(r.date)}${r.sleep_score != null ? `, score ${r.sleep_score}` : ""}`,
              values: { deep: (r.deep_s ?? 0) / 3600, light: (r.light_s ?? 0) / 3600, rem: (r.rem_s ?? 0) / 3600, awake: (r.awake_s ?? 0) / 3600 },
            }))}
            series={[
              { key: "deep", label: "Deep", color: sleepColor.deep },
              { key: "light", label: "Light", color: sleepColor.light },
              { key: "rem", label: "REM", color: sleepColor.rem },
              { key: "awake", label: "Awake", color: sleepColor.awake },
            ]}
            yTick={(v) => f.hoursMinutes(v * 3600).replace(" 00", "")}
            tickEvery={sleepEvery}
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <Trend title="Sleep score" rows={rows} get={(r) => r.sleep_score} unit="" days={days} empty="No sleep scores in this range." />
      </section>

      <section className={`${s.band} ${s.half}`}>
        <Trend
          title="Resting heart rate"
          description="Lower than your normal usually means you're recovered."
          rows={rows}
          get={(r) => r.rhr}
          unit="bpm"
          days={days}
          empty="No resting heart rate in this range."
        />
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Body Battery"
          description="Level at wake, with the day's high and low as a band."
          legend={[
            { label: "At wake", color: sport.run, kind: "line" },
            { label: "Low to high", color: color["ink-4"] },
          ]}
          table={{ columns: ["Date", "At wake", "High", "Low"], rows: rows.map((r) => [f.day(r.date), f.num(r.bb_wake), f.num(r.bb_high), f.num(r.bb_low)]) }}
        >
          <LineChart
            ariaLabel={`Body Battery, last ${days} days`}
            height={180}
            series={[{ key: "wake", label: "At wake", color: sport.run, points: pts(rows, (r) => r.bb_wake) }]}
            band={{ label: "Low to high", color: color["ink-4"], points: rows.map((r) => ({ x: ms(r.date), lo: r.bb_low, hi: r.bb_high })) }}
            xTick={f.dayShort}
            yTick={(v) => f.num(v)}
            tipTitle={f.day}
            yDomain={[0, 100]}
          />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <Trend title="Stress" description="Garmin's daily average, 0–100. Lower is calmer." rows={rows} get={(r) => r.stress_avg} unit="" days={days} empty="No stress data in this range." />
      </section>

      <section className={`${s.band} ${s.half}`}>
        <Trend title="Respiration" description="Average breaths per minute." rows={rows} get={(r) => r.respiration_avg} unit="brpm" digits={1} days={days} empty="No respiration data in this range." />
      </section>

      <section className={`${s.band} ${s.full}`}>
        <Trend
          title="Blood oxygen (SpO2)"
          rows={rows}
          get={(r) => r.spo2_avg}
          unit="%"
          days={days}
          empty="No SpO2 readings. Pulse Ox is off on your watch; turn it on for sleep in the watch settings to see it here (it uses more battery)."
        />
      </section>
    </div>
  );
}
