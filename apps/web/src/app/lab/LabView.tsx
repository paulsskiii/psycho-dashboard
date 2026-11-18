"use client";

import { useCallback, useMemo, useState } from "react";

import { color, sleep as sleepColor, sport, zones } from "@psycho/tokens";

import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { DivergingBars } from "@/components/charts/DivergingBars";
import { LineChart, type Point } from "@/components/charts/LineChart";
import { Meter } from "@/components/charts/Meter";
import { SegmentedBar } from "@/components/charts/SegmentedBar";
import { SmallMultiples } from "@/components/charts/SmallMultiples";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { DateRange, type Preset } from "@/components/ui/DateRange";
import { Nav } from "@/components/ui/Nav";
import { StatTile } from "@/components/ui/StatTile";
import * as f from "@/lib/format";

import s from "./lab.module.css";

type Load = {
  date: string;
  tss_run: number;
  tss_ride: number;
  tss_strength: number;
  ctl: number;
  atl: number;
  tsb: number;
  acwr: number | null;
  ramp_7d: number | null;
  psycho_status: string;
  readiness: number | null;
  warming_up: boolean;
};
type Wellness = {
  date: string;
  rhr: number | null;
  hrv_night_avg: number | null;
  hrv_7d_avg: number | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  sleep_score: number | null;
  sleep_s: number | null;
  deep_s: number | null;
  light_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  bb_wake: number | null;
  stress_avg: number | null;
};
type Activity = { id: number; start_local: string; sport: string; name: string; duration_s: number };
type Metric = { activity_id: number; hrtss: number | null; zone_s: number[] | null };
type ChartCh = { t: number[]; v: number[] };
export type Snapshot = {
  generated_at: string;
  today: string;
  daily_load: Load[];
  wellness: Wellness[];
  activities: Activity[];
  metrics: Metric[];
  latest_run: {
    activity: Activity & { distance_m: number; avg_hr: number; aerobic_te: number };
    chart: Partial<Record<"hr" | "speed" | "cadence" | "alt" | "power", ChartCh>> | null;
  } | null;
};

const DAYS: Record<Preset, number> = { "7 d": 7, "30 d": 30, "90 d": 90, "6 m": 182, "1 y": 365, Custom: 90 };
const ms = (d: string) => +f.toDate(d);
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const latest = <T,>(rows: T[], get: (r: T) => number | null) => {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = get(rows[i]!);
    if (v != null) return v;
  }
  return null;
};

/** Monday-start ISO week key in Manila time. */
function weekKey(d: string): string {
  // Shift Manila midnight by +8 h so the UTC fields read as the Manila calendar date.
  const local = new Date(+f.toDate(d.slice(0, 10)) + 8 * 3600e3);
  const monday = new Date(+local - ((local.getUTCDay() + 6) % 7) * 86400e3);
  return monday.toISOString().slice(0, 10);
}

export function LabView({ snap }: { snap: Snapshot }) {
  const [range, setRange] = useState<Preset>("90 d");
  const [sheet, setSheet] = useState<string | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const days = DAYS[range];

  const load = useMemo(() => snap.daily_load.slice(-days), [snap, days]);
  const well = snap.wellness;
  const last14 = well.slice(-14);
  const prior28 = well.slice(-29, -1);

  const tiles = useMemo(() => {
    const t = (get: (w: Wellness) => number | null) => {
      const v = latest(well, get);
      const m = mean(prior28.map(get));
      return { v, m, spark: last14.map(get) };
    };
    return {
      hrv: t((w) => w.hrv_night_avg),
      rhr: t((w) => w.rhr),
      sleep: t((w) => w.sleep_score),
      bb: t((w) => w.bb_wake),
      stress: t((w) => w.stress_avg),
      readiness: { v: latest(snap.daily_load, (l) => l.readiness), spark: snap.daily_load.slice(-14).map((l) => l.readiness) },
    };
  }, [well, last14, prior28, snap.daily_load]);

  const vsNormal = (v: number | null, m: number | null, unit = "") =>
    v == null || m == null ? undefined : `${f.signed(v - m)}${unit} vs your 28-day normal`;

  // Fitness & fatigue (two lines, one axis) and form (separate diverging chart).
  const ctl: Point[] = load.map((l) => ({ x: ms(l.date), y: l.ctl }));
  const atl: Point[] = load.map((l) => ({ x: ms(l.date), y: l.atl }));
  const warmEnd = load.filter((l) => l.warming_up).at(-1);
  const today = snap.daily_load.at(-1);

  // Weekly load by sport + weekly 3-zone distribution (last 12 weeks).
  const weekly = useMemo(() => {
    const byWeek = new Map<string, { run: number; ride: number; strength: number; low: number; mod: number; high: number }>();
    const metric = new Map(snap.metrics.map((m) => [m.activity_id, m]));
    for (const a of snap.activities) {
      const k = weekKey(a.start_local);
      const w = byWeek.get(k) ?? { run: 0, ride: 0, strength: 0, low: 0, mod: 0, high: 0 };
      const m = metric.get(a.id);
      if (m?.hrtss != null && (a.sport === "run" || a.sport === "ride" || a.sport === "strength")) w[a.sport] += m.hrtss;
      if (m?.zone_s && (a.sport === "run" || a.sport === "ride")) {
        const z = m.zone_s;
        w.low += (z[0] ?? 0) + (z[1] ?? 0);
        w.mod += z[2] ?? 0;
        w.high += (z[3] ?? 0) + (z[4] ?? 0);
      }
      byWeek.set(k, w);
    }
    const keys = [...byWeek.keys()].sort().slice(-12);
    const loadData: BarDatum[] = keys.map((k) => {
      const w = byWeek.get(k)!;
      return { key: k, label: f.dayShort(k), title: `Week of ${f.day(k)}`, values: { run: Math.round(w.run), ride: Math.round(w.ride), strength: Math.round(w.strength) } };
    });
    const zoneData: BarDatum[] = keys.map((k) => {
      const w = byWeek.get(k)!;
      const tot = w.low + w.mod + w.high || 1;
      return {
        key: k,
        label: f.dayShort(k),
        title: `Week of ${f.day(k)}`,
        values: { low: Math.round((w.low / tot) * 100), mod: Math.round((w.mod / tot) * 100), high: Math.round((w.high / tot) * 100) },
      };
    });
    return { loadData, zoneData };
  }, [snap]);

  const run = snap.latest_run;
  const runZones = run ? snap.metrics.find((m) => m.activity_id === run.activity.id)?.zone_s ?? null : null;
  const ch = run?.chart ?? null;
  const toPts = (c: ChartCh | undefined, map: (v: number) => number | null = (v) => v): Point[] =>
    c ? c.t.map((t, i) => ({ x: t, y: map(c.v[i]!) })) : [];
  const minutes = (t: number) => `${Math.round(t / 60)} min`;

  const hrvDays = well.slice(-days);
  const sleepNights = well.filter((w) => w.sleep_s).slice(-14);

  const tickEvery = days > 60 ? Math.ceil(days / 8) : days > 20 ? 7 : 1;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={`display ${s.wordmark}`}>PSYCHO</div>
        <h1 className={`display ${s.pageTitle}`}>Lab</h1>
        <p className={s.lede}>
          Every primitive, with your real data. Snapshot from {f.day(snap.generated_at)} at{" "}
          {new Date(snap.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" })}.
        </p>
      </header>

      <div className={s.grid}>
        <section className={`${s.band} ${s.full}`} aria-labelledby="tiles">
          <h2 id="tiles" className={s.sectionTitle}>
            Overnight
          </h2>
          <div className={s.tiles}>
            <StatTile label="HRV" value={f.num(tiles.hrv.v)} unit="ms" delta={vsNormal(tiles.hrv.v, tiles.hrv.m, " ms")} spark={tiles.hrv.spark} source="Garmin" onOpen={() => setSheet("hrv")} />
            <StatTile label="Resting HR" value={f.num(tiles.rhr.v)} unit="bpm" delta={vsNormal(tiles.rhr.v, tiles.rhr.m)} spark={tiles.rhr.spark} source="Garmin" onOpen={() => setSheet("rhr")} />
            <StatTile label="Sleep score" value={f.num(tiles.sleep.v)} delta={vsNormal(tiles.sleep.v, tiles.sleep.m)} spark={tiles.sleep.spark} source="Garmin" onOpen={() => setSheet("sleep")} />
            <StatTile label="Body Battery at wake" value={f.num(tiles.bb.v)} delta={vsNormal(tiles.bb.v, tiles.bb.m)} spark={tiles.bb.spark} source="Garmin" onOpen={() => setSheet("bb")} />
            <StatTile label="Readiness" value={f.num(tiles.readiness.v)} spark={tiles.readiness.spark} source="Psycho" onOpen={() => setSheet("readiness")} />
            <StatTile label="Stress" value={f.num(tiles.stress.v)} delta={vsNormal(tiles.stress.v, tiles.stress.m)} spark={tiles.stress.spark} source="Garmin" onOpen={() => setSheet("stress")} />
          </div>
        </section>

        <section className={`${s.band} ${s.full}`} aria-label="Date range">
          <DateRange value={range} onChange={setRange} />
        </section>

        <section className={`${s.band} ${s.wide}`}>
          <ChartFrame
            title="Fitness and fatigue"
            description="Fitness (CTL, 42-day) and fatigue (ATL, 7-day) from hrTSS."
            legend={[
              { label: "Fitness", color: sport.run, kind: "line" },
              { label: "Fatigue", color: sport.ride, kind: "line" },
            ]}
            table={{ columns: ["Date", "Fitness", "Fatigue"], rows: load.map((l) => [f.day(l.date), f.num(l.ctl, 1), f.num(l.atl, 1)]) }}
          >
            <LineChart
              ariaLabel={`Fitness and fatigue, last ${days} days`}
              series={[
                { key: "ctl", label: "Fitness", color: sport.run, points: ctl },
                { key: "atl", label: "Fatigue", color: sport.ride, points: atl },
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
            description="A guide, not a rule: the research on ACWR is contested."
            table={{ columns: ["Date", "ACWR"], rows: load.slice(-14).map((l) => [f.day(l.date), f.num(l.acwr, 2)]) }}
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
              bandText={
                today?.acwr == null ? "Not enough history" : today.acwr < 0.8 ? "Under-loading" : today.acwr <= 1.3 ? "In the sweet spot" : today.acwr <= 1.5 ? "Caution" : "High spike"
              }
            />
          </ChartFrame>
        </section>

        <section className={`${s.band} ${s.full}`}>
          <ChartFrame
            title="Form"
            description="Form (TSB) going into each day: fitness minus fatigue."
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
            legend={[
              { label: "Run", color: sport.run },
              { label: "Ride", color: sport.ride },
              { label: "Strength", color: sport.strength },
            ]}
            table={{ columns: ["Week", "Run", "Ride", "Strength"], rows: weekly.loadData.map((d) => [d.title, d.values.run ?? 0, d.values.ride ?? 0, d.values.strength ?? 0]) }}
          >
            <BarChart
              ariaLabel="Weekly hrTSS by sport, last 12 weeks"
              data={weekly.loadData}
              series={[
                { key: "run", label: "Run", color: sport.run },
                { key: "ride", label: "Ride", color: sport.ride },
                { key: "strength", label: "Strength", color: sport.strength },
              ]}
              yTick={(v) => f.num(v)}
              tickEvery={2}
            />
          </ChartFrame>
        </section>

        <section className={`${s.band} ${s.half}`}>
          <ChartFrame
            title="Intensity distribution"
            description="Share of run and ride time by zone each week. Target: 80 % low."
            legend={[
              { label: "Low (Z1–2)", color: zones[0] },
              { label: "Moderate (Z3)", color: zones[2] },
              { label: "High (Z4–5)", color: zones[4] },
              { label: "80 % low target", color: color.ink, kind: "line" },
            ]}
            table={{ columns: ["Week", "Low %", "Moderate %", "High %"], rows: weekly.zoneData.map((d) => [d.title, d.values.low ?? 0, d.values.mod ?? 0, d.values.high ?? 0]) }}
          >
            <BarChart
              ariaLabel="Weekly intensity distribution, last 12 weeks"
              data={weekly.zoneData}
              series={[
                { key: "low", label: "Low", color: zones[0] },
                { key: "mod", label: "Moderate", color: zones[2] },
                { key: "high", label: "High", color: zones[4] },
              ]}
              yTick={(v) => `${f.num(v)} %`}
              yMax={100}
              target={{ value: 80, label: "80 % low" }}
              tickEvery={2}
            />
          </ChartFrame>
        </section>

        <section className={`${s.band} ${s.half}`}>
          <ChartFrame
            title="Overnight HRV"
            description="Nightly average with your baseline band and 7-day average."
            legend={[
              { label: "Nightly", color: sport.run, kind: "line" },
              { label: "7-day average", color: sport.ride, kind: "line" },
              { label: "Baseline", color: color["ink-4"] },
            ]}
            table={{ columns: ["Date", "Nightly", "7-day avg", "Baseline"], rows: hrvDays.map((w) => [f.day(w.date), f.num(w.hrv_night_avg), f.num(w.hrv_7d_avg), w.hrv_baseline_low ? `${w.hrv_baseline_low}–${w.hrv_baseline_high}` : "–"]) }}
          >
            <LineChart
              ariaLabel={`Overnight HRV, last ${days} days`}
              series={[
                { key: "night", label: "Nightly", color: sport.run, points: hrvDays.map((w) => ({ x: ms(w.date), y: w.hrv_night_avg })) },
                { key: "avg", label: "7-day", color: sport.ride, points: hrvDays.map((w) => ({ x: ms(w.date), y: w.hrv_7d_avg })) },
              ]}
              band={{ label: "Baseline", color: color["ink-4"], points: hrvDays.map((w) => ({ x: ms(w.date), lo: w.hrv_baseline_low, hi: w.hrv_baseline_high })) }}
              xTick={f.dayShort}
              yTick={(v) => f.num(v)}
              tipTitle={f.day}
              tipValue={(v) => `${f.num(v)} ms`}
            />
          </ChartFrame>
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
            table={{ columns: ["Night", "Deep", "Light", "REM", "Awake"], rows: sleepNights.map((w) => [f.day(w.date), f.hoursMinutes(w.deep_s), f.hoursMinutes(w.light_s), f.hoursMinutes(w.rem_s), f.hoursMinutes(w.awake_s)]) }}
          >
            <BarChart
              ariaLabel="Sleep stages, last 14 nights"
              data={sleepNights.map((w) => ({
                key: w.date,
                label: f.dayShort(w.date),
                title: `Night to ${f.day(w.date)} · score ${f.num(w.sleep_score)}`,
                values: { deep: (w.deep_s ?? 0) / 3600, light: (w.light_s ?? 0) / 3600, rem: (w.rem_s ?? 0) / 3600, awake: (w.awake_s ?? 0) / 3600 },
              }))}
              series={[
                { key: "deep", label: "Deep", color: sleepColor.deep },
                { key: "light", label: "Light", color: sleepColor.light },
                { key: "rem", label: "REM", color: sleepColor.rem },
                { key: "awake", label: "Awake", color: sleepColor.awake },
              ]}
              yTick={(v) => f.hoursMinutes(v * 3600).replace(" 00", "")}
              tickEvery={3}
            />
          </ChartFrame>
        </section>

        {run && ch ? (
          <section className={`${s.band} ${s.full}`}>
            <div>
              <h2 className={s.sectionTitle}>{run.activity.name}</h2>
              <p className={s.lede}>{f.day(run.activity.start_local)}</p>
            </div>
            {runZones ? (
              <ChartFrame
                title="Time in heart-rate zones"
                table={{ columns: ["Zone", "Time"], rows: runZones.map((z, i) => [`Zone ${i + 1}`, f.duration(z)]) }}
              >
                <SegmentedBar
                  ariaLabel="Time in heart-rate zones"
                  parts={runZones.map((z, i) => ({ key: `z${i + 1}`, label: `Z${i + 1}`, value: z, color: zones[i]!, display: f.duration(z) }))}
                />
              </ChartFrame>
            ) : null}
            <SmallMultiples>
              {(
                [
                  ["Pace", ch.speed, (v: number) => (v >= 0.5 ? 1000 / v : null), (v: number) => f.paceShort(v), (v: number) => f.pace(v), true],
                  ["Heart rate", ch.hr, (v: number) => v, (v: number) => f.num(v), (v: number) => `${f.num(v)} bpm`, false],
                  // Cadence and power read 0 while stopped; that's "no data", not a value.
                  ["Cadence", ch.cadence, (v: number) => (v > 0 ? v : null), (v: number) => f.num(v), (v: number) => `${f.num(v)} spm`, false],
                  ["Elevation", ch.alt, (v: number) => v, (v: number) => f.num(v), (v: number) => `${f.num(v)} m`, false],
                  ["Power", ch.power, (v: number) => (v > 0 ? v : null), (v: number) => f.num(v), (v: number) => `${f.num(v)} W`, false],
                ] as const
              )
                .filter(([, c]) => c && c.t.length)
                .map(([title, c, map, tick, val, inv]) => {
                  const pts = toPts(c, map);
                  return (
                    <ChartFrame key={title} title={title} table={{ columns: ["Time", title], rows: pts.filter((_, i) => i % 20 === 0).map((p) => [f.duration(p.x), p.y == null ? "–" : val(p.y)]) }}>
                      <LineChart
                        ariaLabel={`${title} through the run`}
                        height={120}
                        xKind="linear"
                        series={[{ key: title, label: title, color: sport.run, points: pts }]}
                        xTick={minutes}
                        yTick={tick}
                        tipTitle={(t) => f.duration(t)}
                        tipValue={val}
                        invertY={inv}
                        directLabels={false}
                        robust
                      />
                    </ChartFrame>
                  );
                })}
            </SmallMultiples>
          </section>
        ) : null}

        <section className={`${s.band} ${s.full}`} aria-labelledby="tokens">
          <h2 id="tokens" className={s.sectionTitle}>
            Tokens
          </h2>
          <ul className={s.swatches}>
            {Object.entries(color).map(([k, v]) => (
              <li key={k}>
                <span className={s.chip} style={{ background: v }} />
                <span className={s.chipName}>{k}</span>
                <span className={s.chipHex}>{v}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <BottomSheet open={sheet !== null} title={sheet === "readiness" ? "Readiness" : "Overnight HRV"} onClose={closeSheet}>
        {sheet === "readiness" ? (
          <>
            <p>Psycho&apos;s estimate of how ready you are to train, from 0 to 100. It compares last night&apos;s HRV, resting HR, sleep and Body Battery with your own last 28 days, and adds your form.</p>
            <p>Formula: 50 + 25 × the weighted sum of each input&apos;s z-score (HRV 0.30, resting HR 0.20, sleep 0.20, Body Battery 0.15, form 0.15), clipped to 0–100.</p>
          </>
        ) : (
          <>
            <p>Your average heart-rate variability while asleep, measured by the watch. Higher than your normal usually means you&apos;ve recovered well.</p>
            <p>Source: Garmin overnight HRV. Your normal is your own 28-day average.</p>
          </>
        )}
      </BottomSheet>

      <Nav current="/" />
    </div>
  );
}
