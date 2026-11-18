"use client";

import { useState } from "react";

import s from "./charts.module.css";
import { CrosshairContext } from "./LineChart";

/** Groups charts that share one x-axis; hovering or arrowing any of them moves the crosshair in
 * all of them (spec §10 activity deep-dive). */
export function SmallMultiples({ children }: { children: React.ReactNode }) {
  const [x, setX] = useState<number | null>(null);
  return (
    <CrosshairContext.Provider value={{ x, setX }}>
      <div className={s.multiples}>{children}</div>
    </CrosshairContext.Provider>
  );
}
