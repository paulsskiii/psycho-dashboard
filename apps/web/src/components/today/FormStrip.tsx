"use client";

import { DivergingBars } from "@/components/charts/DivergingBars";
import * as f from "@/lib/format";

/** 28-day form (TSB) strip for Today: compact diverging bars, no table toggle (the /form page
 * has the full chart and its table). */
export function FormStrip({ rows }: { rows: { date: string; tsb: number; warming_up: boolean }[] }) {
  return (
    <DivergingBars
      ariaLabel="Form over the last 28 days"
      height={96}
      data={rows.map((r) => ({ key: r.date, label: f.dayShort(r.date), title: f.day(r.date), value: r.tsb, dim: r.warming_up }))}
      yTick={(v) => f.signed(v)}
      tickEvery={7}
      negLabel="Fatigued"
      posLabel="Fresh"
    />
  );
}
