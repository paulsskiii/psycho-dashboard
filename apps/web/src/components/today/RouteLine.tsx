import { color } from "@psycho/tokens";

/** Equirectangular projection (cos-lat corrected) of [lat, lon] points into an SVG path + viewBox. */
export function projectRoute(route: [number, number][] | null | undefined, padRatio = 0.08) {
  const pts = (route ?? []).filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
  if (pts.length < 3) return null;
  const meanLat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xy = pts.map(([la, lo]) => [lo * k, -la] as const);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0) * padRatio || 1e-4;
  // Rounded: Node and browsers disagree on Math.cos in the last bits, which broke hydration.
  const r = (v: number) => v.toFixed(6);
  return {
    viewBox: `${r(x0 - pad)} ${r(y0 - pad)} ${r(x1 - x0 + 2 * pad)} ${r(y1 - y0 + 2 * pad)}`,
    d: "M" + xy.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join("L"),
  };
}

/** The one memorable thing (spec §9.2): the latest outdoor route as a single parchment stroke,
 * or that day's heart-rate trace when the activity had no GPS. Static here; Phase 5 draws it. */
export function RouteLine({
  route,
  hr,
  label,
}: {
  route?: [number, number][] | null;
  hr?: { t: number[]; v: number[] } | null;
  label: string;
}) {
  let d = "";
  let viewBox = "0 0 100 100";
  let preserve = "xMidYMid meet";

  const projected = (route?.length ?? 0) > 10 ? projectRoute(route) : null;
  if (projected) {
    ({ d, viewBox } = projected);
  } else if (hr && hr.t.length > 10) {
    const t0 = hr.t[0]!;
    const t1 = hr.t[hr.t.length - 1]!;
    const lo = Math.min(...hr.v);
    const hi = Math.max(...hr.v);
    viewBox = `0 0 1000 100`;
    preserve = "none";
    d = "M" + hr.t.map((t, i) => `${(((t - t0) / (t1 - t0 || 1)) * 1000).toFixed(1)},${(92 - ((hr.v[i]! - lo) / (hi - lo || 1)) * 84).toFixed(1)}`).join("L");
  }
  if (!d) return null;
  return (
    <svg viewBox={viewBox} preserveAspectRatio={preserve} width="100%" height="100%" role="img" aria-label={label} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color.brass} strokeOpacity={0.16} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={color.ink} strokeOpacity={0.85} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
