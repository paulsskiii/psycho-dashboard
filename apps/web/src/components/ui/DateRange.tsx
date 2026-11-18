"use client";

import s from "./ui.module.css";

export const PRESETS = ["7 d", "30 d", "90 d", "6 m", "1 y", "Custom"] as const;
export type Preset = (typeof PRESETS)[number];

/** One date-range control per analysis page; scopes every chart beneath it (spec §10). */
export function DateRange({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  function onKey(e: React.KeyboardEvent) {
    const i = PRESETS.indexOf(value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(PRESETS[(i + 1) % PRESETS.length]!);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(PRESETS[(i - 1 + PRESETS.length) % PRESETS.length]!);
    else return;
    e.preventDefault();
  }
  return (
    <div className={s.range} role="radiogroup" aria-label="Date range" onKeyDown={onKey}>
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={p === value}
          tabIndex={p === value ? 0 : -1}
          className={s.rangeOption}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
