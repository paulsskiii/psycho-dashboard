"use client";

import Link from "next/link";
import { useMemo } from "react";

import { sport } from "@psycho/tokens";

import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart } from "@/components/charts/LineChart";
import type { SportSession, SportsData } from "@/lib/data/sports";
import * as f from "@/lib/format";
import { weekKey } from "@/lib/weeks";

import s from "../analysis.module.css";

const ms = (d: string) => +f.toDate(d.length > 10 ? `${d}+08:00` : d);
const titleCase = (c: string) => {
  const t = c.toLowerCase().replaceAll("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Week buckets with a value per session list, oldest first. */
function byWeek(rows: SportSession[]) {
  const m = new Map<string, SportSession[]>();
  for (const r of rows) {
    const k = weekKey(r.start_local);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const tickFor = (n: number) => (n > 16 ? Math.ceil(n / 8) : n > 8 ? 2 : 1);

export function SportsCharts({ data, days, tab }: { data: SportsData; days: number; tab: "ride" | "strength" }) {
  return tab === "ride" ? (
    <Ride rows={data.sessions.filter((x) => x.sport === "ride")} data={data} days={days} />
  ) : (
    <Strength rows={data.sessions.filter((x) => x.sport === "strength")} data={data} days={days} />
  );
}

function SessionList({ rows, value, label }: { rows: SportSession[]; value: (r: SportSession) => string; label: string }) {
  return (
    <ul className={s.list}>
      {[...rows].reverse().slice(0, 12).map((r) => (
        <li key={r.id}>
          <Link className={s.item} href={`/activity/${r.id}`} prefetch={false}>
            <span className={s.itemMain}>
              <span className={s.itemName}>{r.name ?? (r.sport === "ride" ? "Ride" : "Strength")}</span>
              <span className={s.itemMeta}>
                {[f.day(r.start_local), f.duration(r.duration_s), r.avg_hr ? `${r.avg_hr} bpm` : null, r.sets.length ? `${r.sets.length} sets` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={s.itemValue}>
              {value(r)}
              <small>{label}</small>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Ride({ rows, data, days }: { rows: SportSession[]; data: SportsData; days: number }) {
  const weeks = useMemo(() => byWeek(rows), [rows]);
  if (!rows.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>No rides in this range. Your first ride will show up here after it syncs.</p>
      </section>
    );
  }
  const km = rows.reduce((a, r) => a + (r.distance_m ?? 0), 0) / 1000;
  const time = rows.reduce((a, r) => a + (r.duration_s ?? 0), 0);
  const kmh = (r: SportSession) => (r.avg_speed_mps ? r.avg_speed_mps * 3.6 : null);
  const bars: BarDatum[] = weeks.map(([k, rs]) => ({
    key: k,
    label: f.dayShort(k),
    title: `Week of ${f.day(k)} · ${rs.length} ${rs.length === 1 ? "ride" : "rides"}`,
    values: { km: rs.reduce((a, r) => a + (r.distance_m ?? 0), 0) / 1000 },
  }));
  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <dl className={s.stats}>
          <div>
            <dt>Rides</dt>
            <dd>{rows.length}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{f.num(km, 1)} km</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{f.hoursMinutes(time)}</dd>
          </div>
          <div>
            <dt>Share of your load</dt>
            <dd>{data.totals.total ? `${f.num((data.totals.ride / data.totals.total) * 100)} %` : "–"}</dd>
          </div>
        </dl>
      </section>
      <section className={`${s.band} ${s.half}`}>
        <ChartFrame title="Weekly distance" table={{ columns: ["Week", "Rides", "Distance"], rows: weeks.map(([k, rs]) => [f.day(k), rs.length, `${f.num(bars.find((b) => b.key === k)!.values.km, 1)} km`]) }}>
          <BarChart ariaLabel={`Weekly ride distance, last ${days} days`} data={bars} series={[{ key: "km", label: "Distance", color: sport.ride }]} yTick={(v) => `${f.num(v)} km`} tickEvery={tickFor(bars.length)} />
        </ChartFrame>
      </section>
      <section className={`${s.band} ${s.half}`}>
        <ChartFrame title="Average speed" description="Per ride." table={{ columns: ["Date", "Ride", "Speed", "Avg HR"], rows: rows.map((r) => [f.day(r.start_local), r.name ?? "Ride", kmh(r) ? `${f.num(kmh(r), 1)} km/h` : "–", r.avg_hr ? `${r.avg_hr} bpm` : "–"]) }}>
          {rows.length > 1 ? (
            <LineChart
              ariaLabel={`Average ride speed, last ${days} days`}
              series={[{ key: "kmh", label: "Speed", color: sport.ride, points: rows.map((r) => ({ x: ms(r.start_local), y: kmh(r) })) }]}
              xTick={f.dayShort}
              yTick={(v) => f.num(v)}
              tipTitle={f.day}
              tipValue={(v) => `${f.num(v, 1)} km/h`}
            />
          ) : (
            <p className={s.empty}>One ride so far. The trend starts with the second.</p>
          )}
        </ChartFrame>
      </section>
      <section className={`${s.band} ${s.full}`}>
        <ChartFrame title="Recent rides" table={{ columns: ["Date", "Ride", "Distance", "Time", "Avg HR", "hrTSS"], rows: rows.map((r) => [f.day(r.start_local), r.name ?? "Ride", `${f.num((r.distance_m ?? 0) / 1000, 1)} km`, f.duration(r.duration_s), r.avg_hr ?? "–", f.num(r.hrtss)]) }}>
          <SessionList rows={rows} value={(r) => `${f.num((r.distance_m ?? 0) / 1000, 1)} km`} label="distance" />
        </ChartFrame>
      </section>
    </div>
  );
}

function Strength({ rows, data, days }: { rows: SportSession[]; data: SportsData; days: number }) {
  const weeks = useMemo(() => byWeek(rows), [rows]);
  const exercises = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const st of r.sets) if (st.category) m.set(st.category, (m.get(st.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  if (!rows.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>No strength sessions in this range. Your next gym session will show up here after it syncs.</p>
      </section>
    );
  }
  const time = rows.reduce((a, r) => a + (r.duration_s ?? 0), 0);
  const totalSets = rows.reduce((a, r) => a + r.sets.length, 0);
  const bars: BarDatum[] = weeks.map(([k, rs]) => ({
    key: k,
    label: f.dayShort(k),
    title: `Week of ${f.day(k)} · ${rs.length} ${rs.length === 1 ? "session" : "sessions"}`,
    values: { h: rs.reduce((a, r) => a + (r.duration_s ?? 0), 0) / 3600 },
  }));
  const loadBars: BarDatum[] = weeks.map(([k, rs]) => ({ key: k, label: f.dayShort(k), title: `Week of ${f.day(k)}`, values: { tss: rs.reduce((a, r) => a + (r.hrtss ?? 0), 0) } }));
  const tick = tickFor(bars.length);
  const maxSets = exercises[0]?.[1] ?? 1;
  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <dl className={s.stats}>
          <div>
            <dt>Sessions</dt>
            <dd>{rows.length}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{f.hoursMinutes(time)}</dd>
          </div>
          <div>
            <dt>Sets logged</dt>
            <dd>{totalSets ? f.num(totalSets) : "–"}</dd>
          </div>
          <div>
            <dt>Share of your load</dt>
            <dd>{data.totals.total ? `${f.num((data.totals.strength / data.totals.total) * 100)} %` : "–"}</dd>
          </div>
        </dl>
        <p className={s.note}>Strength load comes from heart rate (hrTSS), so it undercounts heavy, low-heart-rate lifting. Treat it as a floor.</p>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame title="Weekly time" description="Strength sessions per week, in hours." table={{ columns: ["Week", "Sessions", "Time"], rows: weeks.map(([k, rs]) => [f.day(k), rs.length, f.hoursMinutes(rs.reduce((a, r) => a + (r.duration_s ?? 0), 0))]) }}>
          <BarChart ariaLabel={`Weekly strength time, last ${days} days`} data={bars} series={[{ key: "h", label: "Time", color: sport.strength }]} yTick={(v) => `${f.num(v, v % 1 ? 1 : 0)} h`} tickEvery={tick} />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame title="Weekly load" description="hrTSS from strength sessions." table={{ columns: ["Week", "hrTSS"], rows: loadBars.map((b) => [b.title, f.num(b.values.tss)]) }}>
          <BarChart ariaLabel={`Weekly strength load, last ${days} days`} data={loadBars} series={[{ key: "tss", label: "hrTSS", color: sport.strength }]} yTick={(v) => f.num(v)} tickEvery={tick} />
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame title="Average heart rate" description="Per session." table={{ columns: ["Date", "Session", "Avg HR"], rows: rows.map((r) => [f.day(r.start_local), r.name ?? "Strength", r.avg_hr ? `${r.avg_hr} bpm` : "–"]) }}>
          {rows.length > 1 ? (
            <LineChart
              ariaLabel={`Average heart rate per strength session, last ${days} days`}
              height={200}
              series={[{ key: "hr", label: "Avg HR", color: sport.strength, points: rows.map((r) => ({ x: ms(r.start_local), y: r.avg_hr })) }]}
              xTick={f.dayShort}
              yTick={(v) => f.num(v)}
              tipTitle={f.day}
              tipValue={(v) => `${f.num(v)} bpm`}
            />
          ) : (
            <p className={s.empty}>One session so far. The trend starts with the second.</p>
          )}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.half}`}>
        <ChartFrame
          title="Most-trained exercises"
          description="Active sets by Garmin's exercise guess. Edit sets in Garmin Connect to fix a wrong guess."
          table={{ columns: ["Exercise", "Sets"], rows: exercises.map(([c, n]) => [titleCase(c), n]) }}
        >
          {exercises.length ? (
            <ul className={s.list}>
              {exercises.slice(0, 8).map(([c, n]) => (
                <li key={c} className={s.item}>
                  <span className={s.itemMain}>
                    <span className={s.itemName}>{titleCase(c)}</span>
                    <span aria-hidden style={{ display: "block", height: 6, width: `${(n / maxSets) * 100}%`, background: sport.strength, borderRadius: "0 2px 2px 0" }} />
                  </span>
                  <span className={s.itemValue}>
                    {n}
                    <small>sets</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.empty}>No sets recorded. Start a Strength activity on the watch and press Lap between sets to log them.</p>
          )}
        </ChartFrame>
      </section>

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Recent sessions"
          table={{ columns: ["Date", "Session", "Time", "Avg HR", "Sets", "hrTSS"], rows: rows.map((r) => [f.day(r.start_local), r.name ?? "Strength", f.duration(r.duration_s), r.avg_hr ?? "–", r.sets.length || "–", f.num(r.hrtss)]) }}
        >
          <SessionList rows={rows} value={(r) => f.num(r.hrtss)} label="hrTSS" />
        </ChartFrame>
      </section>
    </div>
  );
}
