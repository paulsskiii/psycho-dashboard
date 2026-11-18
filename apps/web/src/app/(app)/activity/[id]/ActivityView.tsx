"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { sport as sportColor, zones } from "@psycho/tokens";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart, type Point } from "@/components/charts/LineChart";
import { SegmentedBar } from "@/components/charts/SegmentedBar";
import { SmallMultiples } from "@/components/charts/SmallMultiples";
import { StatusMark } from "@/components/ui/StatusMark";
import type { ActivityData, ChartChannel } from "@/lib/data/activity";
import * as f from "@/lib/format";

import a from "../../analysis.module.css";
import s from "./activity.module.css";

// MapLibre is ~200 KB: only loaded on this page, after the first paint.
const ActivityMap = dynamic(() => import("@/components/activity/ActivityMap").then((m) => m.ActivityMap), {
  ssr: false,
  loading: () => <div style={{ height: "clamp(260px, 50vw, 420px)", background: "var(--page)" }} />,
});

const SPORT = { run: "Run", ride: "Ride", strength: "Strength", walk: "Walk", other: "Activity" } as const;
const TE_LABEL: Record<string, string> = {
  RECOVERY: "Recovery",
  AEROBIC_BASE: "Base",
  TEMPO: "Tempo",
  LACTATE_THRESHOLD: "Threshold",
  VO2MAX: "VO2 max",
  ANAEROBIC_CAPACITY: "Anaerobic",
  SPEED: "Speed",
};

function pts(c: ChartChannel | undefined, map: (v: number) => number | null = (v) => v): Point[] {
  return c ? c.t.map((t, i) => ({ x: t, y: map(c.v[i]!) })) : [];
}

function Stat({ label, value, source }: { label: string; value: string; source?: "Garmin" | "Psycho" }) {
  return (
    <div>
      <dt>
        {label}
        {source ? <span className={s.src}>{source}</span> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ActivityView({ data }: { data: ActivityData }) {
  const { activity: x, metrics: m, chart, splits, zoneFloors } = data;
  const isRun = x.sport === "run";
  const isRide = x.sport === "ride";
  const minutes = (t: number) => `${Math.round(t / 60)} min`;
  const pace = isRun && x.avg_speed_mps ? 1000 / x.avg_speed_mps : null;

  // HR chart background: Garmin's 5 zones as faint bands of the zone ramp.
  const floors = zoneFloors?.length === 5 ? zoneFloors : null;
  const hrBands = floors
    ? floors.map((lo, i) => ({ from: lo, to: floors[i + 1] ?? lo + 30, color: zones[i]!, label: `Zone ${i + 1}` }))
    : undefined;

  const channels = (
    [
      { title: "Pace", c: isRun ? chart?.speed : undefined, map: (v: number) => (v >= 0.5 ? 1000 / v : null), tick: f.paceShort, val: f.pace, inv: true },
      { title: "Speed", c: isRide ? chart?.speed : undefined, map: (v: number) => (v > 0 ? v * 3.6 : null), tick: (v: number) => f.num(v), val: (v: number) => `${f.num(v, 1)} km/h`, inv: false },
      { title: "Heart rate", c: chart?.hr, map: (v: number) => v, tick: (v: number) => f.num(v), val: (v: number) => `${f.num(v)} bpm`, inv: false, bands: hrBands },
      { title: "Cadence", c: isRun || isRide ? chart?.cadence : undefined, map: (v: number) => (v > 0 ? v : null), tick: (v: number) => f.num(v), val: (v: number) => `${f.num(v)} ${isRun ? "spm" : "rpm"}`, inv: false },
      { title: "Elevation", c: x.has_gps ? chart?.alt : undefined, map: (v: number) => v, tick: (v: number) => f.num(v), val: (v: number) => `${f.num(v)} m`, inv: false },
      { title: "Power", c: chart?.power, map: (v: number) => (v > 0 ? v : null), tick: (v: number) => f.num(v), val: (v: number) => `${f.num(v)} W`, inv: false },
    ] as const
  ).filter((ch) => ch.c && ch.c.t.length > 10);

  const splitPaces = splits.map((sp) => (sp.avg_speed_mps ? 1000 / sp.avg_speed_mps : null)).filter((v): v is number => v != null);
  const [fast, slow] = [Math.min(...splitPaces), Math.max(...splitPaces)];
  const zoneTotal = m?.zone_s?.reduce((p, c) => p + c, 0) ?? 0;
  const sets = (x.exercise_sets ?? []).filter((st) => st.setType === "ACTIVE");

  return (
    <main className={a.page}>
      <header className={s.head}>
        <Link href="/runs" className={s.back}>
          All activities
        </Link>
        <h1 className={s.title}>{x.name ?? SPORT[x.sport]}</h1>
        <p className={s.when}>
          {f.day(x.start_local)}, {x.start_local.slice(11, 16)}
          {x.indoor && x.sport !== "strength" ? ", indoor" : ""}
        </p>
      </header>

      {x.has_gps && chart?.route?.length ? (
        <section className={s.mapBand} aria-label="Map">
          <ActivityMap route={chart.route} kmMarks={data.kmMarks} label={`Map of ${x.name ?? "the activity"}`} />
        </section>
      ) : null}

      <div className={a.grid}>
        <section className={`${a.band} ${a.full}`} aria-labelledby="summary">
          <h2 id="summary" className="visually-hidden">
            Summary
          </h2>
          <dl className={s.stats}>
            {x.distance_m && x.distance_m > 300 ? <Stat label="Distance" value={`${f.num(x.distance_m / 1000, 2)} km`} /> : null}
            <Stat label="Time" value={f.duration(x.duration_s)} />
            {x.moving_s && x.duration_s && x.duration_s - x.moving_s > 60 ? <Stat label="Moving" value={f.duration(x.moving_s)} /> : null}
            {pace ? <Stat label="Pace" value={f.pace(pace)} /> : null}
            {isRide && x.avg_speed_mps ? <Stat label="Speed" value={`${f.num(x.avg_speed_mps * 3.6, 1)} km/h`} /> : null}
            {x.avg_hr ? <Stat label="Avg HR" value={`${x.avg_hr} bpm`} /> : null}
            {x.max_hr ? <Stat label="Max HR" value={`${x.max_hr} bpm`} /> : null}
            {x.elev_gain_m && x.has_gps ? <Stat label="Climb" value={`${f.num(x.elev_gain_m)} m`} /> : null}
            {x.avg_cadence && (isRun || isRide) ? <Stat label="Cadence" value={`${f.num(x.avg_cadence)} ${isRun ? "spm" : "rpm"}`} /> : null}
            {x.avg_power ? <Stat label="Power" value={`${f.num(x.avg_power)} W`} /> : null}
            {x.calories ? <Stat label="Calories" value={f.num(x.calories)} /> : null}
          </dl>
          <dl className={s.stats}>
            <Stat label="Load" value={m?.hrtss == null ? "–" : `${m.hrtss_estimated ? "~" : ""}${f.num(m.hrtss)}`} source="Psycho" />
            {x.aerobic_te != null ? (
              <Stat label="Training effect" value={`${f.num(x.aerobic_te, 1)} / ${f.num(x.anaerobic_te, 1)}`} source="Garmin" />
            ) : null}
            {x.te_label ? <Stat label="Benefit" value={TE_LABEL[x.te_label] ?? x.te_label} source="Garmin" /> : null}
            {x.vo2max ? <Stat label="VO2 max" value={f.num(x.vo2max)} source="Garmin" /> : null}
            {m?.ef ? <Stat label="Efficiency" value={f.num(m.ef, 2)} source="Psycho" /> : null}
            {m?.decoupling_pct != null ? <Stat label="Decoupling" value={`${f.num(m.decoupling_pct, 1)} %`} source="Psycho" /> : null}
            {m?.pace_at_hr_s_per_km ? <Stat label="Pace in Z2" value={f.pace(m.pace_at_hr_s_per_km)} source="Psycho" /> : null}
          </dl>
          {m?.hrtss_estimated ? <p className={a.note}>Load is estimated from duration: this activity has no heart-rate data.</p> : null}
          {m?.drifted_hard ? (
            <p className={a.note}>
              <StatusMark kind="warning" label="Drifted hard" />: an easy run with 30 % or more of its time in zone 3 or above.
            </p>
          ) : null}
          {m?.decoupling_pct != null ? (
            <p className={a.note}>
              {m.decoupling_pct < 5
                ? "Durable: your heart rate held steady against pace in the second half."
                : "Your heart rate drifted up against pace in the second half (5 % or more)."}
              {m.hilly ? " Hilly run, so it's left out of your efficiency trend." : ""}
            </p>
          ) : null}
          {x.weather?.temp_c != null ? (
            <p className={a.note}>
              Weather: {f.num(x.weather.temp_c)} °C
              {x.weather.apparent_c != null && Math.abs(x.weather.apparent_c - x.weather.temp_c) >= 2 ? `, feels like ${f.num(x.weather.apparent_c)} °C` : ""}
              {x.weather.humidity_pct != null ? `, ${f.num(x.weather.humidity_pct)} % humidity` : ""}
              {x.weather.desc ? `, ${x.weather.desc.toLowerCase()}` : ""}.
            </p>
          ) : null}
        </section>

        {m?.zone_s && zoneTotal > 0 ? (
          <section className={`${a.band} ${a.full}`}>
            <ChartFrame title="Time in heart-rate zones" table={{ columns: ["Zone", "Time", "Share"], rows: m.zone_s.map((z, i) => [`Zone ${i + 1}`, f.duration(z), `${Math.round((z / zoneTotal) * 100)} %`]) }}>
              <SegmentedBar ariaLabel="Time in heart-rate zones" parts={m.zone_s.map((z, i) => ({ key: `z${i + 1}`, label: `Z${i + 1}`, value: z, color: zones[i]!, display: f.duration(z) }))} />
            </ChartFrame>
          </section>
        ) : null}

        {channels.length ? (
          <section className={`${a.band} ${a.full}`} aria-label="Streams">
            <SmallMultiples>
              {channels.map((ch) => {
                const p = pts(ch.c, ch.map);
                return (
                  <ChartFrame
                    key={ch.title}
                    title={ch.title}
                    legend={"bands" in ch && ch.bands ? undefined : undefined}
                    table={{ columns: ["Time", ch.title], rows: p.filter((_, i) => i % 20 === 0).map((q) => [f.duration(q.x), q.y == null ? "–" : ch.val(q.y)]) }}
                  >
                    <LineChart
                      ariaLabel={`${ch.title} through the activity`}
                      height={120}
                      xKind="linear"
                      series={[{ key: ch.title, label: ch.title, color: sportColor[isRide ? "ride" : x.sport === "strength" ? "strength" : "run"], points: p }]}
                      xTick={minutes}
                      yTick={ch.tick}
                      tipTitle={(t) => f.duration(t)}
                      tipValue={ch.val}
                      invertY={ch.inv}
                      directLabels={false}
                      robust
                      yBands={"bands" in ch ? ch.bands : undefined}
                    />
                  </ChartFrame>
                );
              })}
            </SmallMultiples>
          </section>
        ) : null}

        {isRun && splits.length > 1 ? (
          <section className={`${a.band} ${a.full}`} aria-labelledby="splits">
            <h2 id="splits" className={s.h2}>
              Kilometre splits
            </h2>
            <table className={s.splits}>
              <thead>
                <tr>
                  <th scope="col">Km</th>
                  <th scope="col">Pace</th>
                  <th scope="col" className={s.barCol}>
                    <span className="visually-hidden">Pace bar</span>
                  </th>
                  <th scope="col">HR</th>
                  <th scope="col">Climb</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((sp) => {
                  const p = sp.avg_speed_mps ? 1000 / sp.avg_speed_mps : null;
                  // Faster = longer bar; slowest split still shows a stub.
                  const w = p == null || slow === fast ? 100 : 15 + ((slow - p) / (slow - fast)) * 85;
                  const partial = sp.distance_m != null && sp.distance_m < 950;
                  return (
                    <tr key={sp.idx}>
                      <th scope="row">{partial ? f.num((sp.distance_m ?? 0) / 1000, 2) : sp.idx + 1}</th>
                      <td>{p ? f.paceShort(p) : "–"}</td>
                      <td className={s.barCol}>
                        <span className={s.bar} style={{ width: `${w}%`, background: sportColor.run, opacity: p === fast ? 1 : 0.8 }} />
                      </td>
                      <td>{sp.avg_hr ?? "–"}</td>
                      <td>{sp.elev_gain_m != null ? `${f.num(sp.elev_gain_m)} m` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {sets.length ? (
          <section className={`${a.band} ${a.full}`} aria-labelledby="sets">
            <h2 id="sets" className={s.h2}>
              Sets
            </h2>
            <ol className={s.sets}>
              {sets.map((st, i) => {
                const ex = st.exercises?.[0];
                const name = ex && ex.category !== "UNKNOWN" ? ex.category.toLowerCase().replaceAll("_", " ") : "Set";
                return (
                  <li key={i}>
                    <span className={s.setName}>{name.charAt(0).toUpperCase() + name.slice(1)}</span>
                    <span>{st.repetitionCount ? `${st.repetitionCount} reps` : ""}</span>
                    <span>{st.weight ? `${f.num(st.weight / 1000, 1)} kg` : ""}</span>
                    <span>{st.duration ? f.duration(st.duration) : ""}</span>
                  </li>
                );
              })}
            </ol>
            <p className={a.note}>Exercise names are Garmin&apos;s automatic guesses from wrist movement.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
