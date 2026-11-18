"use client";

import { useId, useState } from "react";

import s from "./charts.module.css";

export type LegendItem = { label: string; color: string; kind?: "line" | "fill" };
export type TableSpec = { columns: string[]; rows: (string | number)[][] };

type Props = {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: TableSpec;
  stale?: boolean;
  children: React.ReactNode;
};

/** Title, legend, chart ↔ table toggle (spec §10: every chart has a table twin). */
export function ChartFrame({ title, description, legend, table, stale, children }: Props) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className={s.frame} aria-labelledby={`${id}-t`} style={{ margin: 0 }}>
      <div className={s.header}>
        <div>
          <div id={`${id}-t`} className={s.title}>
            {title}
          </div>
          {description ? <p className={s.description}>{description}</p> : null}
        </div>
        <button
          type="button"
          className={s.toggle}
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {legend && legend.length >= 2 ? (
        <ul className={s.legend} aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span
                className={l.kind === "line" ? s.swatchLine : s.swatch}
                style={{ background: l.color }}
                aria-hidden
              />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {asTable ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption>{title}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j}>{v}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`${s.plot} ${stale ? s.stale : ""}`}>{children}</div>
      )}
    </figure>
  );
}
