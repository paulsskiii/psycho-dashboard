"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";

import { color } from "@psycho/tokens";

import s from "./charts.module.css";
import { Tooltip } from "./Tooltip";
import { SVG_STYLE, boxStyle, labelWidth, tickAnchor, useWidth } from "./useSize";

export type DumbbellDatum = { key: string; label: string; title: string; a: number | null; b: number | null };

/** Two values per category joined by a connector (e.g. weekly aerobic vs anaerobic Training
 * Effect). Dots ≥ 8 px with a 2 px surface ring; one y-axis. */
export function Dumbbell({
  data,
  a,
  b,
  ariaLabel,
  height = 200,
  yDomain,
  yTick,
}: {
  data: DumbbellDatum[];
  a: { label: string; color: string };
  b: { label: string; color: string };
  ariaLabel: string;
  height?: number;
  yDomain: [number, number];
  yTick: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const y = scaleLinear().domain(yDomain).nice(4);
    const yTicks = y.ticks(4);
    const margin = { top: 12, right: 8, bottom: 24, left: Math.max(...yTicks.map((t) => labelWidth(yTick(t)))) + 8 };
    const innerW = Math.max(0, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;
    y.range([innerH, 0]);
    const x = scaleBand<string>().domain(data.map((d) => d.key)).range([0, innerW]).padding(0.2);
    return { y, yTicks, margin, innerW, innerH, x };
  }, [data, width, height, yDomain, yTick]);
  const { y, yTicks, margin, innerW, innerH, x } = geo;
  const every = Math.max(1, Math.ceil(80 / Math.max(1, x.step())));
  const hd = hover == null ? null : data[hover];

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
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} stroke={t === yTicks[0] ? color.axis : color.rule} />
                <text className={s.tick} x={-8} dy="0.32em" textAnchor="end">
                  {yTick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = (x(d.key) ?? 0) + x.bandwidth() / 2;
              const dim = hover != null && hover !== i;
              return (
                <g key={d.key} opacity={dim ? 0.5 : 1}>
                  {d.a != null && d.b != null ? <line x1={cx} x2={cx} y1={y(d.a)} y2={y(d.b)} stroke={color.axis} strokeWidth={2} /> : null}
                  {d.b != null ? <circle cx={cx} cy={y(d.b)} r={4.5} fill={b.color} stroke={color.surface} strokeWidth={2} /> : null}
                  {d.a != null ? <circle cx={cx} cy={y(d.a)} r={4.5} fill={a.color} stroke={color.surface} strokeWidth={2} /> : null}
                  {(data.length - 1 - i) % every === 0 ? (
                    <text className={s.tick} x={cx} y={innerH + 18} textAnchor={tickAnchor(cx, innerW)}>
                      {d.label}
                    </text>
                  ) : null}
                  <rect
                    x={x(d.key) ?? 0}
                    width={Math.max(24, x.step())}
                    height={innerH}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}
      {hd && width > 0 ? (
        <Tooltip
          x={margin.left + (x(hd.key) ?? 0) + x.bandwidth() / 2}
          y={margin.top}
          width={width}
          title={hd.title}
          rows={[
            { value: hd.a == null ? "–" : yTick(hd.a), name: a.label, color: a.color },
            { value: hd.b == null ? "–" : yTick(hd.b), name: b.label, color: b.color },
          ]}
        />
      ) : null}
    </div>
  );
}
