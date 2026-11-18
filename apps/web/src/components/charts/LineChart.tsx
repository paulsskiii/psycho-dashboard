"use client";

import { bisector, extent, quantileSorted } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { createContext, useContext, useId, useMemo, useState } from "react";

import { color } from "@psycho/tokens";

import s from "./charts.module.css";
import { Tooltip } from "./Tooltip";
import { SVG_STYLE, boxStyle, labelWidth, tickAnchor, useWidth } from "./useSize";

export type Point = { x: number; y: number | null };
export type LineSeries = { key: string; label: string; color: string; points: Point[] };
export type Band = {
  label: string;
  color: string;
  points: { x: number; lo: number | null; hi: number | null }[];
};

/** Shared crosshair for small multiples: every chart in the group snaps to the same x. */
export const CrosshairContext = createContext<{
  x: number | null;
  setX: (x: number | null) => void;
} | null>(null);

type Props = {
  series: LineSeries[];
  ariaLabel: string;
  height?: number;
  xKind?: "time" | "linear";
  xTick: (x: number) => string;
  yTick: (y: number) => string;
  tipTitle: (x: number) => string;
  tipValue?: (y: number) => string;
  band?: Band;
  wash?: boolean;
  dimUntil?: number;
  dimLabel?: string;
  includeZero?: boolean;
  invertY?: boolean;
  directLabels?: boolean;
  yDomain?: [number, number];
  /** Fit the y-axis to the 2nd–98th percentile so stops and GPS spikes don't flatten the line. */
  robust?: boolean;
  /** Horizontal background bands (e.g. HR zones), drawn faintly behind the data. */
  yBands?: { from: number; to: number; color: string; label: string }[];
};

const bis = bisector<Point, number>((p) => p.x).center;

export function LineChart({
  series,
  ariaLabel,
  height = 220,
  xKind = "time",
  xTick,
  yTick,
  tipTitle,
  tipValue,
  band,
  wash,
  dimUntil,
  dimLabel,
  includeZero,
  invertY,
  directLabels = true,
  yDomain,
  robust,
  yBands,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const clipId = useId();
  const shared = useContext(CrosshairContext);
  const [localX, setLocalX] = useState<number | null>(null);
  const hoverX = shared ? shared.x : localX;
  const setHoverX = shared ? shared.setX : setLocalX;

  const primary = useMemo(() => series[0]?.points ?? [], [series]);

  const geo = useMemo(() => {
    const ys: number[] = [];
    for (const sr of series) for (const p of sr.points) if (p.y != null) ys.push(p.y);
    if (band) for (const p of band.points) for (const v of [p.lo, p.hi]) if (v != null) ys.push(v);
    const sorted = [...ys].sort((a, b) => a - b);
    let [y0, y1] = yDomain ?? (robust && sorted.length > 20
      ? [quantileSorted(sorted, 0.02) as number, quantileSorted(sorted, 0.98) as number]
      : (extent(ys) as [number, number]));
    if (y0 === undefined || y1 === undefined) [y0, y1] = [0, 1];
    if (!yDomain) {
      if (includeZero) {
        y0 = Math.min(0, y0);
        y1 = Math.max(0, y1);
      }
      const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08;
      const nonNegative = (sorted[0] ?? 0) >= 0;
      y0 -= includeZero && y0 === 0 ? 0 : pad;
      y1 += pad;
      if (nonNegative) y0 = Math.max(0, y0); // never show negative ticks for non-negative data
    }
    const y = scaleLinear().domain(invertY ? [y1, y0] : [y0, y1]).nice(4);
    const yTicks = y.ticks(4);
    const left = Math.max(...yTicks.map((t) => labelWidth(yTick(t)))) + 8;
    // Endpoint labels live in a right gutter so they never sit on the data.
    const roomy = width >= 560;
    const endTexts = directLabels
      ? series.map((sr) => {
          const last = [...sr.points].reverse().find((p) => p.y != null);
          const val = last?.y == null ? "" : (tipValue ?? yTick)(last.y);
          return series.length > 1 ? (roomy ? `${sr.label} ${val}` : sr.label) : val;
        })
      : [];
    const right = endTexts.length ? Math.max(...endTexts.map(labelWidth)) + 10 : 8;
    const margin = { top: 12, right, bottom: 24, left };
    const innerW = Math.max(0, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;
    y.range([innerH, 0]);
    const xs = primary.map((p) => p.x);
    const xExt = extent(series.flatMap((sr) => sr.points.map((p) => p.x))) as [number, number];
    const x = xKind === "time" ? scaleTime().domain(xExt.map((v) => new Date(v)) as [Date, Date]) : scaleLinear().domain(xExt);
    x.range([0, innerW]);
    const xPos = (v: number) => x(xKind === "time" ? (new Date(v) as unknown as number) : v) as number;
    const xTicks = (x.ticks(Math.max(2, Math.floor(innerW / 96))) as (Date | number)[]).map((t) => +t);
    return { y, yTicks, margin, innerW, innerH, x, xs, xPos, xTicks, endTexts };
  }, [series, band, width, height, xKind, includeZero, invertY, yDomain, yTick, primary, robust, directLabels, tipValue]);

  const { y, yTicks, margin, innerW, innerH, xPos, xTicks, xs } = geo;

  const paths = useMemo(() => {
    const mk = line<Point>()
      .defined((p) => p.y != null)
      .x((p) => xPos(p.x))
      .y((p) => y(p.y as number))
      .curve(curveMonotoneX);
    const washPath =
      wash && series.length === 1 && series[0]
        ? area<Point>()
            .defined((p) => p.y != null)
            .x((p) => xPos(p.x))
            .y0(innerH)
            .y1((p) => y(p.y as number))
            .curve(curveMonotoneX)(series[0].points)
        : null;
    const bandPath = band
      ? area<Band["points"][number]>()
          .defined((p) => p.lo != null && p.hi != null)
          .x((p) => xPos(p.x))
          .y0((p) => y(p.lo as number))
          .y1((p) => y(p.hi as number))
          .curve(curveMonotoneX)(band.points)
      : null;
    return { lines: series.map((sr) => mk(sr.points) ?? ""), washPath, bandPath };
  }, [series, band, wash, xPos, y, innerH]);

  // Endpoint labels in the right gutter at each series' last value, nudged ≥ 14 px apart.
  const labels = useMemo(() => {
    const ls = series
      .map((sr, i) => {
        const last = [...sr.points].reverse().find((p) => p.y != null);
        const text = geo.endTexts[i];
        if (!last || last.y == null || !text) return null;
        return { key: sr.key, text, y: Math.min(innerH, Math.max(0, y(last.y))) };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) {
      const prev = ls[i - 1]!;
      const cur = ls[i]!;
      if (cur.y - prev.y < 14) cur.y = prev.y + 14;
    }
    return ls;
  }, [series, geo.endTexts, y, innerH]);

  const hoverIdx = hoverX == null || !primary.length ? null : bis(primary, hoverX);
  const hp = hoverIdx == null ? null : primary[hoverIdx];

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const v = xKind === "time" ? +(geo.x.invert(px) as Date) : (geo.x.invert(px) as number);
    const i = bis(primary, v);
    const p = primary[i];
    if (p) setHoverX(p.x);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!xs.length) return;
    let i = hoverIdx ?? xs.length - 1;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(xs.length - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = xs.length - 1;
    else if (e.key === "Escape") return setHoverX(null);
    else return;
    e.preventDefault();
    setHoverX(xs[i] ?? null);
  }

  const tipRows =
    hp == null
      ? []
      : series.map((sr) => {
          const p = sr.points[bis(sr.points, hp.x)];
          return { value: p?.y == null ? "–" : (tipValue ?? yTick)(p.y), name: sr.label, color: sr.color };
        });

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
          onFocus={() => hoverX == null && xs.length && setHoverX(xs[xs.length - 1] ?? null)}
          onBlur={() => setHoverX(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} stroke={t === 0 && includeZero ? color.axis : color.rule} strokeWidth={1} />
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
            <clipPath id={clipId}>
              <rect x={-2} y={-2} width={innerW + 4} height={innerH + 4} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              {yBands?.map((b) => {
                const ya = y(b.from);
                const yb = y(b.to);
                return (
                  <rect key={b.label} x={0} width={innerW} y={Math.min(ya, yb)} height={Math.abs(yb - ya)} fill={b.color} opacity={0.14}>
                    <title>{b.label}</title>
                  </rect>
                );
              })}
              {paths.bandPath && band ? <path d={paths.bandPath} fill={band.color} opacity={0.22} /> : null}
              {paths.washPath && series[0] ? <path d={paths.washPath} fill={series[0].color} opacity={0.1} /> : null}
              {/* Drawn last-to-first so series[0], the one that matters, sits on top. */}
              {series.map((sr, i) => ({ sr, i })).reverse().map(({ sr, i }) => (
                <path
                  key={sr.key}
                  d={paths.lines[i]}
                  fill="none"
                  stroke={sr.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
            {dimUntil != null && primary[0] && dimUntil > primary[0].x ? (
              <g>
                <rect x={0} y={0} width={Math.max(0, xPos(dimUntil))} height={innerH} fill={color.page} opacity={0.55} />
                {dimLabel ? (
                  <text className={s.tick} x={6} y={12}>
                    {dimLabel}
                  </text>
                ) : null}
              </g>
            ) : null}
            {labels.map((l) => (
              <text key={l.key} className={s.directLabel} x={innerW + 8} y={l.y} dy="0.32em">
                {l.text}
              </text>
            ))}
            {hp ? (
              <g pointerEvents="none">
                <line x1={xPos(hp.x)} x2={xPos(hp.x)} y2={innerH} stroke={color.axis} />
                {series.map((sr) => {
                  const p = sr.points[bis(sr.points, hp.x)];
                  const [d0, d1] = y.domain() as [number, number];
                  const inDomain = p?.y != null && p.y >= Math.min(d0, d1) && p.y <= Math.max(d0, d1);
                  return p?.y == null || !inDomain ? null : (
                    <circle key={sr.key} cx={xPos(p.x)} cy={y(p.y)} r={4} fill={sr.color} stroke={color.surface} strokeWidth={2} />
                  );
                })}
              </g>
            ) : null}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHoverX(null)}
            />
          </g>
        </svg>
      ) : null}
      {hp && width > 0 ? (
        <Tooltip x={margin.left + xPos(hp.x)} y={margin.top} width={width} title={tipTitle(hp.x)} rows={tipRows} />
      ) : null}
    </div>
  );
}
