import { diverging, status } from "@psycho/tokens";

import { StatusMark, type StatusKind } from "../ui/StatusMark";
import * as f from "@/lib/format";
import s from "./charts.module.css";

export type StatusKey = "productive" | "maintaining" | "recovering" | "overreaching" | "detraining" | "unproductive";

// State, not series: icon + label always accompany the colour (spec §9.4). Recovering borrows the
// "fresh" diverging step and maintaining the neutral midpoint; the four alarms use status colours.
export const STATUS_META: Record<StatusKey, { label: string; kind: StatusKind; color: string }> = {
  productive: { label: "Productive", kind: "good", color: status.good },
  maintaining: { label: "Maintaining", kind: "none", color: diverging.mid },
  recovering: { label: "Recovering", kind: "none", color: diverging.fresh[1] },
  detraining: { label: "Detraining", kind: "warning", color: status.warning },
  unproductive: { label: "Unproductive", kind: "serious", color: status.serious },
  overreaching: { label: "Overreaching", kind: "critical", color: status.critical },
};

type Run = { key: StatusKey; from: string; to: string; days: number };

function runs(rows: { date: string; status: string | null }[]): Run[] {
  const out: Run[] = [];
  for (const r of rows) {
    const k = r.status as StatusKey | null;
    if (!k || !(k in STATUS_META)) continue;
    const last = out.at(-1);
    if (last && last.key === k) {
      last.to = r.date;
      last.days += 1;
    } else out.push({ key: k, from: r.date, to: r.date, days: 1 });
  }
  return out;
}

/** Psycho training status over time: contiguous periods as one strip, plus the periods listed in
 * words (newest first) so nothing depends on colour or hover. */
export function StatusTimeline({ rows }: { rows: { date: string; status: string | null }[] }) {
  const rs = runs(rows);
  const total = rs.reduce((a, r) => a + r.days, 0) || 1;
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <div className={s.segBar} style={{ height: 12 }} aria-hidden>
        {rs.map((r, i) => (
          <div
            key={`${r.from}-${i}`}
            className={s.seg}
            title={`${STATUS_META[r.key].label}: ${f.day(r.from)} to ${f.day(r.to)}`}
            style={{ flexGrow: r.days, flexBasis: 0, background: STATUS_META[r.key].color, minWidth: 2 }}
          />
        ))}
      </div>
      <ol className={s.periods} aria-label="Training status periods, newest first">
        {[...rs].reverse().slice(0, 6).map((r, i) => (
          <li key={`${r.from}-${i}`}>
            <StatusMark kind={STATUS_META[r.key].kind} label={STATUS_META[r.key].label} />
            <span className={s.periodDates}>
              {r.days === 1 ? f.day(r.from) : `${f.day(r.from)} to ${f.day(r.to)}`} ({r.days} {r.days === 1 ? "day" : "days"},{" "}
              {Math.round((r.days / total) * 100)} %)
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
