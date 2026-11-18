"use client";

import { color, sport } from "@psycho/tokens";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart } from "@/components/charts/LineChart";
import type { BodyData } from "@/lib/data/body";
import * as f from "@/lib/format";

import s from "../analysis.module.css";

const ms = (d: string) => +f.toDate(d);
const kg = (v: number | null | undefined) => (v == null ? "–" : `${f.num(v, 1)} kg`);
const DAY = 86400e3;

export function BodyCharts({ data, days }: { data: BodyData; days: number }) {
  const rows = data.days;
  const latest = data.latest;
  // 7-day average of the weigh-ins in the trailing week (calendar days, not entries).
  const avg7 = rows.map((r) => {
    const t = ms(r.date);
    const w = rows.filter((q) => ms(q.date) <= t && ms(q.date) > t - 7 * DAY).map((q) => q.weight_kg!);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const lastAvg = avg7.at(-1) ?? null;
  const toTarget = data.target != null && latest?.weight_kg != null ? latest.weight_kg - data.target : null;
  const comp = rows.filter((r) => r.body_fat_pct != null || r.muscle_kg != null || r.water_pct != null || r.bone_kg != null);

  return (
    <div className={s.grid}>
      <section className={`${s.band} ${s.full}`}>
        <dl className={s.stats}>
          <div>
            <dt>Latest weight</dt>
            <dd>{kg(latest?.weight_kg)}</dd>
          </div>
          <div>
            <dt>7-day average</dt>
            <dd>{kg(lastAvg)}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{kg(data.target)}</dd>
          </div>
          <div>
            <dt>To go</dt>
            <dd>{toTarget == null ? "–" : toTarget <= 0 ? "At target" : kg(toTarget)}</dd>
          </div>
        </dl>
        <p className={s.note}>
          {latest ? `Last weigh-in ${f.day(latest.ts)}, ${f.ago(latest.ts)}, from Garmin. ` : "No weigh-ins yet. "}
          Weigh in with the Garmin Connect app (Health stats → Weight) or a Garmin scale and it shows up here after the next nightly sync.
        </p>
      </section>

      <section className={`${s.band} ${s.full}`}>
        <ChartFrame
          title="Weight"
          description="Each weigh-in, with the 7-day average and your target."
          legend={rows.length < 2 ? undefined : [
            { label: "7-day average", color: sport.run, kind: "line" },
            { label: "Weigh-in", color: color["ink-4"], kind: "line" },
            ...(data.target != null ? [{ label: `Target ${f.num(data.target, 1)} kg`, color: color["ink-3"], kind: "line" as const }] : []),
          ]}
          table={{ columns: ["Date", "Weight", "7-day average"], rows: rows.map((r, i) => [f.day(r.date), kg(r.weight_kg), kg(avg7[i])]) }}
        >
          {rows.length > 1 ? (
            <LineChart
              ariaLabel={`Weight, last ${days} days`}
              series={[
                { key: "avg", label: "7-day", color: sport.run, points: rows.map((r, i) => ({ x: ms(r.date), y: avg7[i] ?? null })) },
                { key: "w", label: "Weigh-in", color: color["ink-4"], points: rows.map((r) => ({ x: ms(r.date), y: r.weight_kg })) },
                ...(data.target != null ? [{ key: "target", label: "Target", color: color["ink-3"], points: rows.map((r) => ({ x: ms(r.date), y: data.target })) }] : []),
              ]}
              xTick={f.dayShort}
              yTick={(v) => f.num(v)}
              tipTitle={f.day}
              tipValue={kg}
            />
          ) : (
            <p className={s.empty}>
              {rows.length === 1 ? `One weigh-in in this range (${kg(rows[0]!.weight_kg)} on ${f.day(rows[0]!.date)}). ` : "No weigh-ins in this range. "}
              The trend needs at least two days.
            </p>
          )}
        </ChartFrame>
      </section>

      {comp.length ? (
        <section className={`${s.band} ${s.full}`}>
          <ChartFrame
            title="Body composition"
            table={{ columns: ["Date", "Body fat", "Muscle", "Bone", "Water"], rows: comp.map((r) => [f.day(r.date), r.body_fat_pct == null ? "–" : `${f.num(r.body_fat_pct, 1)} %`, kg(r.muscle_kg), kg(r.bone_kg), r.water_pct == null ? "–" : `${f.num(r.water_pct, 1)} %`]) }}
          >
            <ul className={s.list}>
              {[...comp].reverse().slice(0, 8).map((r) => (
                <li key={r.date} className={s.item}>
                  <span className={s.itemMain}>
                    <span className={s.itemName}>{f.day(r.date)}</span>
                    <span className={s.itemMeta}>
                      Muscle {kg(r.muscle_kg)} · Bone {kg(r.bone_kg)} · Water {r.water_pct == null ? "–" : `${f.num(r.water_pct, 1)} %`}
                    </span>
                  </span>
                  <span className={s.itemValue}>
                    {r.body_fat_pct == null ? "–" : `${f.num(r.body_fat_pct, 1)} %`}
                    <small>body fat</small>
                  </span>
                </li>
              ))}
            </ul>
          </ChartFrame>
        </section>
      ) : null}
    </div>
  );
}
