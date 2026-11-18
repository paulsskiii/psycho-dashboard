import type { StyleSpecification } from "maplibre-gl";

import { color } from "@psycho/tokens";

/** Psycho's warm-dark basemap (spec §13: custom style in the repo). Quiet on purpose: espresso
 * land, a walnut step for parks and water, roads as rule/axis hairlines, labels in muted ink —
 * so the route is the only loud thing. MapTiler's free OpenMapTiles vector tiles + fonts. */
export function warmDarkStyle(key: string): StyleSpecification {
  const roads = (filter: unknown[], width: number, c: string) => ({
    type: "line" as const,
    source: "omt",
    "source-layer": "transportation",
    filter: filter as never,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: { "line-color": c, "line-width": ["interpolate", ["linear"], ["zoom"], 10, width * 0.4, 16, width * 2.5] as never },
  });
  return {
    version: 8,
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sources: { omt: { type: "vector", url: `https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key=${key}` } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": color.page } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": color.surface } },
      { id: "landcover", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", "class", "grass", "wood"], paint: { "fill-color": color.surface, "fill-opacity": 0.7 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": color.raised } },
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": color.surface } },
      { id: "road-minor", ...roads(["in", "class", "minor", "service", "track", "path"], 1, color.rule) },
      { id: "road-major", ...roads(["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"], 1.6, color.axis) },
      {
        id: "road-label",
        type: "symbol",
        source: "omt",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
        paint: { "text-color": color["ink-4"], "text-halo-color": color.page, "text-halo-width": 1 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["in", "class", "city", "town", "suburb", "neighbourhood"],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
        paint: { "text-color": color["ink-3"], "text-halo-color": color.page, "text-halo-width": 1.5 },
      },
    ],
  };
}
