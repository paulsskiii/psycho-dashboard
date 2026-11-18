"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";

import { color } from "@psycho/tokens";

import { projectRoute } from "@/components/today/RouteLine";

import { warmDarkStyle } from "./mapStyle";

type Props = { route: [number, number][]; kmMarks: { km: number; at: [number, number] }[]; label: string };

/** Warm-dark MapLibre map: parchment route with a brass glow, km ticks, start and finish.
 * Without NEXT_PUBLIC_MAPTILER_KEY (or if WebGL fails) it draws the route alone, which still
 * reads as the activity. Loaded lazily so MapLibre never weighs on other pages. */
export function ActivityMap({ route, kmMarks, label }: Props) {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!key || !box.current || route.length < 2) return;
    let map: import("maplibre-gl").Map | null = null;
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import("maplibre-gl"); // v6: ESM, named exports only
        if (cancelled || !box.current) return;
        const coords = route.map(([la, lo]) => [lo, la] as [number, number]);
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibre.LngLatBounds(coords[0]!, coords[0]!));
        const m = new maplibre.Map({
          container: box.current,
          style: warmDarkStyle(key),
          bounds,
          fitBoundsOptions: { padding: 32 },
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        map = m;
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        m.on("load", () => {
          m.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } });
          m.addLayer({ id: "route-glow", type: "line", source: "route", paint: { "line-color": color.brass, "line-width": 10, "line-opacity": 0.2 }, layout: { "line-cap": "round", "line-join": "round" } });
          m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": color.ink, "line-width": 2.5 }, layout: { "line-cap": "round", "line-join": "round" } });
          m.addSource("marks", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                ...kmMarks.map((m) => ({ type: "Feature" as const, properties: { label: String(m.km), kind: "km" }, geometry: { type: "Point" as const, coordinates: [m.at[1], m.at[0]] } })),
                { type: "Feature" as const, properties: { label: "Start", kind: "end" }, geometry: { type: "Point" as const, coordinates: coords[0]! } },
                { type: "Feature" as const, properties: { label: "Finish", kind: "end" }, geometry: { type: "Point" as const, coordinates: coords.at(-1)! } },
              ],
            },
          });
          m.addLayer({ id: "marks", type: "circle", source: "marks", paint: { "circle-radius": ["match", ["get", "kind"], "end", 6, 4], "circle-color": ["match", ["get", "kind"], "end", color.brass, color.ink], "circle-stroke-color": color.page, "circle-stroke-width": 2 } });
          m.addLayer({
            id: "mark-labels",
            type: "symbol",
            source: "marks",
            layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top" },
            paint: { "text-color": color["ink-2"], "text-halo-color": color.page, "text-halo-width": 1.5 },
          });
        });
        m.on("error", (e) => {
          if (/key|unauthor|403|401/i.test(String(e.error?.message ?? ""))) setFailed(true);
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [key, route, kmMarks]);

  if (!key || failed) {
    const p = projectRoute(route);
    return (
      <div style={{ height: "clamp(260px, 50vw, 420px)", background: "var(--page)" }}>
        {p ? (
          <svg viewBox={p.viewBox} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" role="img" aria-label={label}>
            <path d={p.d} fill="none" stroke={color.brass} strokeOpacity={0.2} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={p.d} fill="none" stroke={color.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
    );
  }
  return <div ref={box} role="region" aria-label={label} style={{ height: "clamp(260px, 50vw, 420px)", background: "var(--page)" }} />;
}
