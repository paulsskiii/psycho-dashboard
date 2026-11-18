"use client";

import { Sparkline } from "../charts/Sparkline";
import s from "./ui.module.css";

export type Source = "Garmin" | "Psycho";

/** Label, value, delta vs a named period, 14-point sparkline, source badge. Tapping it opens the
 * metric's info sheet (spec §7). */
export function StatTile({
  label,
  value,
  unit,
  delta,
  spark,
  source,
  onOpen,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  spark?: (number | null)[];
  source: Source;
  onOpen?: () => void;
}) {
  return (
    <button type="button" className={s.tile} onClick={onOpen} aria-label={`${label} ${value}${unit ? ` ${unit}` : ""}. ${delta ?? ""} Source ${source}. Open details.`}>
      <span className={s.tileTop}>
        <span className={s.tileLabel}>{label}</span>
        <span className={s.badge}>{source}</span>
      </span>
      <span className={s.tileValue}>
        {value}
        {unit ? <span className={s.tileUnit}>{unit}</span> : null}
      </span>
      {/* Always render all four rows so tiles in a row align on a shared subgrid. */}
      <span className={s.tileDelta}>{delta ?? ""}</span>
      <span className={s.tileSpark}>{spark ? <Sparkline values={spark} /> : null}</span>
    </button>
  );
}
