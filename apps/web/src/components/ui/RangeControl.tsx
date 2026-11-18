"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { RANGES, type RangeKey } from "@/lib/range";

import s from "./ui.module.css";

/** The one date-range control at the top of an analysis page; scopes every chart beneath it.
 * While the new range loads, the page keeps the previous render (spec §11: no skeleton flash). */
export function RangeControl({ value }: { value: RangeKey }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function choose(key: RangeKey) {
    const next = new URLSearchParams(params);
    next.set("range", key);
    start(() => router.replace(`${path}?${next}`, { scroll: false }));
  }
  function onKey(e: React.KeyboardEvent) {
    const i = RANGES.findIndex((r) => r.key === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    choose(RANGES[(i + step + RANGES.length) % RANGES.length]!.key);
  }

  return (
    <div className={s.range} role="radiogroup" aria-label="Date range" aria-busy={pending} onKeyDown={onKey}>
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          role="radio"
          aria-checked={r.key === value}
          tabIndex={r.key === value ? 0 : -1}
          className={s.rangeOption}
          onClick={() => choose(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
