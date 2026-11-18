"use client";

import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";

import { color } from "@psycho/tokens";

import { SVG_STYLE, boxStyle, useWidth } from "./useSize";

/** 14-point trend for a stat tile. No axes; the last point is marked. Decorative: the tile
 * states the value and delta in text, so the sparkline is aria-hidden. */
export function Sparkline({ values, height = 28 }: { values: (number | null)[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pts = values.map((v, i) => ({ i, v }));
  const [lo, hi] = extent(values.filter((v): v is number => v != null)) as [number, number];
  const x = scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([3, Math.max(3, width - 4)]);
  const y = scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([height - 4, 4]);
  const d = line<{ i: number; v: number | null }>()
    .defined((p) => p.v != null)
    .x((p) => x(p.i))
    .y((p) => y(p.v as number))(pts);
  const last = [...pts].reverse().find((p) => p.v != null);
  return (
    <div ref={ref} style={boxStyle(height)} aria-hidden>
      {width > 0 && lo !== undefined ? (
        <svg width={width} height={height} style={SVG_STYLE}>
          <path d={d ?? ""} fill="none" stroke={color["ink-3"]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {last ? <circle cx={x(last.i)} cy={y(last.v as number)} r={3} fill={color.ink} /> : null}
        </svg>
      ) : null}
    </div>
  );
}
