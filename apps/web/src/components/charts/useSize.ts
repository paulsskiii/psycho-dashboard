"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Width of the element, tracked with ResizeObserver. 0 until mounted (server render). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Chart box: its width comes only from the parent. The <svg> inside is absolutely positioned
 * (SVG_STYLE) so its pixel width can never prop the box open; without this, charts drawn at a
 * wide size never shrink when the window narrows (ResizeObserver sees no change). */
export function boxStyle(height: number): React.CSSProperties {
  return { position: "relative", height, width: "100%", minWidth: 0 };
}
export const SVG_STYLE: React.CSSProperties = { position: "absolute", left: 0, top: 0, overflow: "visible" };

/** Anchor x-axis labels inward near the plot edges so "17 Nov" never hangs off the side. */
export function tickAnchor(x: number, innerW: number): "start" | "middle" | "end" {
  if (x < 24) return "start";
  if (x > innerW - 24) return "end";
  return "middle";
}

/** Rough tick-label width at 12 px tabular figures; used to size margins so labels never clip. */
export function labelWidth(text: string): number {
  return Math.ceil(text.length * 7.2) + 2;
}
