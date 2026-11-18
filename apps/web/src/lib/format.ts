// Display formats (spec §9.5): pace m:ss /km, durations h:mm:ss, dates "Mon 16 Nov".

const TZ = "Asia/Manila";

export function pace(sPerKm: number | null | undefined): string {
  if (sPerKm == null || !Number.isFinite(sPerKm) || sPerKm <= 0) return "–";
  const s = Math.round(sPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}

export function paceShort(sPerKm: number): string {
  const s = Math.round(sPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function duration(totalS: number | null | undefined): string {
  if (totalS == null || !Number.isFinite(totalS)) return "–";
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

/** "7 h 40" */
export function hoursMinutes(totalS: number | null | undefined): string {
  if (totalS == null) return "–";
  const m = Math.round(totalS / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });

// en-GB writes September as "Sept"; the spec's format is three letters throughout.
const sep = (s: string) => s.replace("Sept", "Sep");

/** "Mon 16 Nov" */
export function day(d: Date | string | number): string {
  return sep(dayFmt.format(toDate(d)).replace(",", ""));
}

/** "16 Nov" for axis ticks */
export function dayShort(d: Date | string | number): string {
  return sep(shortFmt.format(toDate(d)));
}

export function toDate(d: Date | string | number): Date {
  if (d instanceof Date) return d;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00+08:00`);
  return new Date(d);
}

/** "6 min ago", "3 h ago", "2 days ago" */
export function ago(when: Date | string | number | null | undefined, now = Date.now()): string {
  if (when == null) return "never";
  const s = Math.max(0, Math.round((now - +toDate(when)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-PH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = num(Math.abs(v), digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

/** "Tue 17 Nov, 23:13" (Manila) */
export function dateTime(d: Date | string | number): string {
  return `${day(d)}, ${timeFmt.format(toDate(d))}`;
}
