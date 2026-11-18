"use client";

import { scaleLinear } from "d3-scale";

import { color, zones } from "@psycho/tokens";

import s from "./charts.module.css";
import { SVG_STYLE, boxStyle, useWidth } from "./useSize";

export type MeterBand = { from: number; to: number; label: string };

/** Ratio against limits. Track is a darker step of the brass ramp, fill a lighter one; guide
 * bands are ticked and named underneath so the reading never depends on colour. */
export function Meter({
  value,
  domain,
  bands,
  label,
  valueText,
  bandText,
}: {
  value: number | null;
  domain: [number, number];
  bands: MeterBand[];
  label: string;
  valueText: string;
  bandText: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = 12;
  const x = scaleLinear().domain(domain).range([0, Math.max(0, width)]).clamp(true);
  const v = value ?? domain[0];
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div className={s.meterValue}>
        <strong>{valueText}</strong>
        <span>{bandText}</span>
      </div>
      <div ref={ref} style={boxStyle(h + 30)}>
        {width > 0 ? (
          <svg
            style={SVG_STYLE}
            width={width}
            height={h + 30}
            role="meter"
            aria-label={label}
            aria-valuemin={domain[0]}
            aria-valuemax={domain[1]}
            aria-valuenow={value ?? undefined}
            aria-valuetext={`${valueText}, ${bandText}`}
          >
            <rect width={width} height={h} rx={4} fill={zones[0]} />
            {value != null ? <rect width={x(v)} height={h} rx={4} fill={zones[3]} /> : null}
            {bands.slice(1).map((b) => (
              <line key={b.from} x1={x(b.from)} x2={x(b.from)} y1={-2} y2={h + 4} stroke={color.surface} strokeWidth={2} />
            ))}
            {value != null ? (
              <rect x={Math.min(width - 3, Math.max(0, x(v) - 1.5))} y={-4} width={3} height={h + 8} fill={color.ink} />
            ) : null}
            {bands.map((b) => {
              const cx = (x(b.from) + x(b.to)) / 2;
              const narrow = x(b.to) - x(b.from) < 56;
              return (
                <text key={b.label} className={s.tick} x={cx} y={h + 22} textAnchor="middle">
                  {narrow ? b.label.split(" ")[0] : b.label}
                </text>
              );
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}
