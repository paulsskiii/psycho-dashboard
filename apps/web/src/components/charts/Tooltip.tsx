"use client";

import s from "./charts.module.css";

export type TipRow = { value: string; name?: string; color?: string };

/** Value first (strong), series name second (muted). React escapes text: no innerHTML. */
export function Tooltip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number;
  y: number;
  width: number;
  title?: string;
  rows: TipRow[];
}) {
  const flip = x > width - 140;
  return (
    <div
      className={s.tooltip}
      role="status"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: Math.max(0, y - 8),
      }}
    >
      {title ? <div className={s.tipTitle}>{title}</div> : null}
      {rows.map((r, i) => (
        <div key={i} className={s.tipRow}>
          {r.color ? <span className={s.swatch} style={{ background: r.color }} aria-hidden /> : null}
          <strong>{r.value}</strong>
          {r.name ? <span className={s.name}>{r.name}</span> : null}
        </div>
      ))}
    </div>
  );
}
