"use client";

import { extent } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { curveMonotoneX, line } from "d3-shape";
import { useId, useMemo, useState } from "react";

import { color } from "@psycho/tokens";

import s from "./charts.module.css";
import { Tooltip, type TipRow } from "./Tooltip";
import { SVG_STYLE, boxStyle, labelWidth, tickAnchor, useWidth } from "./useSize";

export type Dot = {
  key: string;
  x: number;
  y: number;
  color: string;
  /** Greyed context (e.g. hilly or treadmill runs): drawn hollow in ink-4 under the rest. */
  muted?: boolean;
  title: string;
  rows: TipRow[];
};

type Props = {
  dots: Dot[];
  ariaLabel: string;
  height?: number;
  xKind?: "time" | "linear";
  xTick: (x: number) => string;
  yTick: (y: number) => string;
  /** Optional trend line through the non-muted dots (e.g. a rolling mean). */
  trend?: { label: string; color: string; points: { x: number; y: number | null }[] };
  invertY?: boolean;
  /** Horizontal reference line (e.g. the 5 % "durable" threshold). */
  refLine?: { value: number; label: string };
};

/** Dots ≥ 8 px with a 2 px surface ring (spec §11). Hover snaps to the nearest dot; arrow keys
 * step through dots in x order, and the tooltip doubles as a live region. */
export function Scatter({ dots, ariaLabel, height = 220, xKind = "time", xTick, yTick, trend, invertY, refLine }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const sorted = useMemo(() => [...dots].sort((a, b) => a.x - b.x), [dots]);

  const geo = useMemo(() => {
    const ys = sorted.map((d) => d.y);
    if (refLine) ys.push(refLine.value);
    let [y0, y1] = extent(ys) as [number, number];
    if (y0 === undefined || y1 === undefined) [y0, y1] = [0, 1];
    const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.1;
    y0 = (ys.every((v) => v >= 0) ? Math.max(0, y0 - pad) : y0 - pad);
    y1 += pad;
    const y = scaleLinear().domain(invertY ? [y1, y0] : [y0, y1]).nice(4);
    const yTicks = y.ticks(4);
    const margin = { top: 12, right: refLine ? labelWidth(refLine.label) + 10 : 12, bottom: 24, left: Math.max(...yTicks.map((t) => labelWidth(yTick(t)))) + 8 };
    const innerW = Math.max(0, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;
    y.range([innerH, 0]);
    let xExt = extent(sorted, (d) => d.x) as [number, number];
    if (xExt[0] === undefined) xExt = [0, 1];
    if (xExt[0] === xExt[1]) xExt = [xExt[0] - 1, xExt[1] + 1];
    const xPad = (xExt[1] - xExt[0]) * 0.03;
    const dom: [number, number] = [xExt[0] - xPad, xExt[1] + xPad];
    const x = xKind === "time" ? scaleTime().domain(dom.map((v) => new Date(v)) as [Date, Date]) : scaleLinear().domain(dom).nice();
    x.range([0, innerW]);
    const xPos = (v: number) => x(xKind === "time" ? (new Date(v) as unknown as number) : v) as number;
    const xTicks = (x.ticks(Math.max(2, Math.floor(innerW / 96))) as (Date | number)[]).map((t) => +t);
    return { y, yTicks, margin, innerW, innerH, xPos, xTicks };
  }, [sorted, width, height, xKind, invertY, yTick, refLine]);

  const { y, yTicks, margin, innerW, innerH, xPos, xTicks } = geo;
  const trendPath = useMemo(
    () =>
      trend
        ? (line<{ x: number; y: number | null }>()
            .defined((p) => p.y != null)
            .x((p) => xPos(p.x))
            .y((p) => y(p.y as number))
            .curve(curveMonotoneX)(trend.points) ?? "")
        : "",
    [trend, xPos, y],
  );

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = -1;
    let bestD = Infinity;
    sorted.forEach((d, i) => {
      const dist = Math.hypot(xPos(d.x) - px, y(d.y) - py);
      if (dist < bestD) [best, bestD] = [i, dist];
    });
    setHover(best >= 0 && bestD < 40 ? best : null);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!sorted.length) return;
    let i = hover ?? sorted.length - 1;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(sorted.length - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = sorted.length - 1;
    else if (e.key === "Escape") return setHover(null);
    else return;
    e.preventDefault();
    setHover(i);
  }

  const hd = hover == null ? null : sorted[hover];
  // Muted dots first so the dots that count sit on top.
  const order = [...sorted.map((d, i) => ({ d, i }))].sort((a, b) => Number(b.d.muted ?? false) - Number(a.d.muted ?? false));

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
          onFocus={() => hover == null && sorted.length && setHover(sorted.length - 1)}
          onBlur={() => setHover(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} stroke={color.rule} strokeWidth={1} />
                <text className={s.tick} x={-8} dy="0.32em" textAnchor="end">
                  {yTick(t)}
                </text>
              </g>
            ))}
            <line y1={innerH} y2={innerH} x2={innerW} stroke={color.axis} />
            {xTicks.map((t) => (
              <text key={t} className={s.tick} x={xPos(t)} y={innerH + 18} textAnchor={tickAnchor(xPos(t), innerW)}>
                {xTick(t)}
              </text>
            ))}
            {refLine ? (
              <g transform={`translate(0,${y(refLine.value)})`}>
                <line x2={innerW} stroke={color["ink-3"]} strokeWidth={1} />
                <text className={s.directLabel} x={innerW + 8} dy="0.32em">
                  {refLine.label}
                </text>
              </g>
            ) : null}
            <clipPath id={clipId}>
              <rect x={-6} y={-6} width={innerW + 12} height={innerH + 12} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              {trend ? <path d={trendPath} fill="none" stroke={trend.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {order.map(({ d, i }) =>
                d.muted ? (
                  <circle key={d.key} cx={xPos(d.x)} cy={y(d.y)} r={3.5} fill={color.surface} stroke={color["ink-4"]} strokeWidth={1.5} />
                ) : (
                  <circle key={d.key} cx={xPos(d.x)} cy={y(d.y)} r={i === hover ? 6 : 5} fill={d.color} stroke={color.surface} strokeWidth={2} />
                ),
              )}
            </g>
            {hd ? <circle cx={xPos(hd.x)} cy={y(hd.y)} r={9} fill="none" stroke={color.ink} strokeWidth={1.5} pointerEvents="none" /> : null}
            <rect width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      ) : null}
      {hd && width > 0 ? <Tooltip x={margin.left + xPos(hd.x)} y={margin.top + y(hd.y) - 24} width={width} title={hd.title} rows={hd.rows} /> : null}
    </div>
  );
}
