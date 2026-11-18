"use client";

import { extent } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";

import { color, diverging } from "@psycho/tokens";

import s from "./charts.module.css";
import { Tooltip } from "./Tooltip";
import { SVG_STYLE, boxStyle, labelWidth, tickAnchor, useWidth } from "./useSize";

export type DivDatum = { key: string; label: string; title: string; value: number | null; dim?: boolean };

/** Magnitude → diverging step. Arms brighten towards the extremes; |v| < 2 reads as "nothing". */
export function divergingColor(v: number): string {
  const a = Math.abs(v);
  if (a < 2) return diverging.mid;
  const level = a < 10 ? 1 : a < 20 ? 2 : a < 30 ? 3 : 4;
  return v < 0 ? diverging.fatigued[4 - level]! : diverging.fresh[level - 1]!;
}

type Props = {
  data: DivDatum[];
  ariaLabel: string;
  height?: number;
  yTick: (v: number) => string;
  tickEvery?: number;
  negLabel: string;
  posLabel: string;
};

const R = 2;

function barPath(x: number, y0: number, y1: number, w: number): string {
  // Rounded at the data end (away from zero), square at the baseline.
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const r = Math.min(R, w / 2, h);
  return up
    ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
    : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

export function DivergingBars({ data, ariaLabel, height = 200, yTick, tickEvery = 7, negLabel, posLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const [lo, hi] = extent(data, (d) => d.value ?? 0) as [number, number];
    const m = Math.max(Math.abs(lo ?? 0), Math.abs(hi ?? 0), 10);
    const y = scaleLinear().domain([-m, m]).nice(4);
    const yTicks = y.ticks(height < 140 ? 2 : 4); // short strips get fewer labels
    const margin = { top: 18, right: 8, bottom: 24, left: Math.max(...yTicks.map((t) => labelWidth(yTick(t)))) + 8 };
    const innerW = Math.max(0, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;
    y.range([innerH, 0]);
    const x = scaleBand<string>().domain(data.map((d) => d.key)).range([0, innerW]).paddingInner(data.length > 60 ? 0.15 : 0.3);
    const barW = Math.max(1, Math.min(24, x.bandwidth()));
    return { y, yTicks, margin, innerW, innerH, x, barW };
  }, [data, width, height, yTick]);

  const { y, yTicks, margin, innerW, innerH, x, barW } = geo;
  const hd = hover == null ? null : data[hover];
  const every = Math.max(tickEvery, Math.ceil(80 / Math.max(0.5, x.step())));

  function onKey(e: React.KeyboardEvent) {
    let i = hover ?? data.length - 1;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(data.length - 1, i + 1);
    else if (e.key === "Escape") return setHover(null);
    else return;
    e.preventDefault();
    setHover(i);
  }

  return (
    <div ref={ref} style={boxStyle(height)}>
      {width > 0 ? (
        <svg
          style={SVG_STYLE}
          width={width}
          height={height}
          role="img"
          aria-label={`${ariaLabel}. Use the arrow keys to read values.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => hover == null && setHover(data.length - 1)}
          onBlur={() => setHover(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            <text className={s.tick} x={0} y={-6}>
              {posLabel}
            </text>
            <text className={s.tick} x={0} y={innerH - 4} dy="-0.2em">
              {negLabel}
            </text>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                {t !== 0 ? <line x2={innerW} stroke={color.rule} /> : null}
                <text className={s.tick} x={-8} dy="0.32em" textAnchor="end">
                  {yTick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const bx = (x(d.key) ?? 0) + (x.bandwidth() - barW) / 2;
              return (
                <g key={d.key} opacity={(d.dim ? 0.45 : 1) * (hover == null || hover === i ? 1 : 0.6)}>
                  {d.value != null ? <path d={barPath(bx, y(0), y(d.value), barW)} fill={divergingColor(d.value)} /> : null}
                  {(data.length - 1 - i) % every === 0 ? (
                    <text className={s.tick} x={bx + barW / 2} y={innerH + 18} textAnchor={tickAnchor(bx + barW / 2, innerW)}>
                      {d.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line y1={y(0)} y2={y(0)} x2={innerW} stroke={color.axis} />
            {data.map((d, i) => (
              <rect
                key={d.key}
                x={x(d.key) ?? 0}
                width={x.step()}
                height={innerH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      ) : null}
      {hd && width > 0 ? (
        <Tooltip
          x={margin.left + (x(hd.key) ?? 0)}
          y={margin.top}
          width={width}
          title={hd.title}
          rows={[{ value: hd.value == null ? "–" : yTick(hd.value), name: hd.value != null && hd.value < 0 ? negLabel : posLabel }]}
        />
      ) : null}
    </div>
  );
}
