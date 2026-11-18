"use client";

import { max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";

import { color } from "@psycho/tokens";

import s from "./charts.module.css";
import { Tooltip } from "./Tooltip";
import { SVG_STYLE, boxStyle, labelWidth, tickAnchor, useWidth } from "./useSize";

export type BarSeries = { key: string; label: string; color: string };
export type BarDatum = { key: string; label: string; title: string; values: Record<string, number> };

type Props = {
  data: BarDatum[];
  series: BarSeries[];
  ariaLabel: string;
  mode?: "stacked" | "grouped";
  height?: number;
  yTick: (v: number) => string;
  yMax?: number;
  target?: { value: number; label: string };
  tickEvery?: number;
};

const GAP = 2;
const MAX_BAR = 24;
const R = 4;

/** Rect with a 4 px rounded data-end (top) and a square baseline. */
function barPath(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return "";
  const r = round ? Math.min(R, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({ data, series, ariaLabel, mode = "stacked", height = 220, yTick, yMax, target, tickEvery = 1 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const totals = data.map((d) =>
      mode === "stacked" ? series.reduce((a, sr) => a + (d.values[sr.key] ?? 0), 0) : max(series, (sr) => d.values[sr.key] ?? 0) ?? 0,
    );
    const top = yMax ?? Math.max(target?.value ?? 0, max(totals) ?? 0) * 1.08;
    const y = scaleLinear().domain([0, top || 1]).nice(4);
    const yTicks = y.ticks(4);
    const margin = { top: 12, right: 8, bottom: 24, left: Math.max(...yTicks.map((t) => labelWidth(yTick(t)))) + 8 };
    const innerW = Math.max(0, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;
    y.range([innerH, 0]);
    const x = scaleBand<string>().domain(data.map((d) => d.key)).range([0, innerW]).paddingInner(0.3).paddingOuter(0.15);
    const slot = x.bandwidth();
    const barW = mode === "stacked" ? Math.min(MAX_BAR, slot) : Math.min(MAX_BAR, (slot - GAP * (series.length - 1)) / series.length);
    return { y, yTicks, margin, innerW, innerH, x, slot, barW };
  }, [data, series, mode, width, height, yMax, target, yTick]);

  const { y, yTicks, margin, innerW, innerH, x, slot, barW } = geo;
  const hd = hover == null ? null : data[hover];
  // Thin x labels by available width (≈ 56 px per "26 Oct" label), never by count alone.
  const every = Math.max(tickEvery, Math.ceil(80 / Math.max(1, x.step())));

  function onKey(e: React.KeyboardEvent) {
    if (!data.length) return;
    let i = hover ?? data.length - 1;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(data.length - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = data.length - 1;
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
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                {t !== 0 ? <line x2={innerW} stroke={color.rule} /> : null}
                <text className={s.tick} x={-8} dy="0.32em" textAnchor="end">
                  {yTick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = x(d.key) ?? 0;
              const cx = x0 + slot / 2;
              let acc = 0;
              const marks =
                mode === "stacked"
                  ? (() => {
                      const present = series.filter((sr) => (d.values[sr.key] ?? 0) > 0);
                      return present.map((sr, j) => {
                        const v = d.values[sr.key] ?? 0;
                        const yTop = y(acc + v);
                        const yBot = y(acc);
                        acc += v;
                        const isTop = j === present.length - 1;
                        // 2 px surface gap between stacked segments (taken from the lower segment's top).
                        const h = Math.max(0, yBot - yTop - (isTop ? 0 : GAP));
                        return <path key={sr.key} d={barPath(cx - barW / 2, yTop + (isTop ? 0 : GAP), barW, h, isTop)} fill={sr.color} />;
                      });
                    })()
                  : series.map((sr, j) => {
                      const v = d.values[sr.key] ?? 0;
                      const groupW = barW * series.length + GAP * (series.length - 1);
                      const bx = cx - groupW / 2 + j * (barW + GAP);
                      return <path key={sr.key} d={barPath(bx, y(v), barW, innerH - y(v), true)} fill={sr.color} />;
                    });
              return (
                <g key={d.key} opacity={hover == null || hover === i ? 1 : 0.55}>
                  {marks}
                  {(data.length - 1 - i) % every === 0 ? (
                    <text className={s.tick} x={cx} y={innerH + 18} textAnchor={tickAnchor(cx, innerW)}>
                      {d.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line y1={innerH} y2={innerH} x2={innerW} stroke={color.axis} />
            {target ? (
              // Named in the chart's legend, not on the plot, so it never overprints bars.
              <line pointerEvents="none" y1={y(target.value)} y2={y(target.value)} x2={innerW} stroke={color.ink} strokeWidth={1} aria-label={target.label} />
            ) : null}
            {data.map((d, i) => (
              <rect
                key={d.key}
                x={(x(d.key) ?? 0) - (x.step() - slot) / 2}
                width={Math.max(24, x.step())}
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
          x={margin.left + (x(hd.key) ?? 0) + slot / 2}
          y={margin.top}
          width={width}
          title={hd.title}
          rows={[...series]
            .reverse()
            .filter((sr) => hd.values[sr.key] != null)
            .map((sr) => ({ value: yTick(hd.values[sr.key] ?? 0), name: sr.label, color: sr.color }))}
        />
      ) : null}
    </div>
  );
}
