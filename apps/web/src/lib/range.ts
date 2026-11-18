// Date-range presets shared by every analysis page (spec §10). Lives in the URL (?range=90d)
// so server components fetch only the range shown and links keep it.

export const RANGES = [
  { key: "7d", label: "7 d", days: 7 },
  { key: "30d", label: "30 d", days: 30 },
  { key: "90d", label: "90 d", days: 90 },
  { key: "6m", label: "6 m", days: 182 },
  { key: "1y", label: "1 y", days: 365 },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "90d";

export function parseRange(v: string | string[] | undefined) {
  const key = (Array.isArray(v) ? v[0] : v) as RangeKey | undefined;
  return RANGES.find((r) => r.key === key) ?? RANGES.find((r) => r.key === DEFAULT_RANGE)!;
}
