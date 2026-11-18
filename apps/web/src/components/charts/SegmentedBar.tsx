import s from "./charts.module.css";

export type Segment = { key: string; label: string; value: number; color: string; display: string };

/** Relative luminance, to pick a legible label colour on a filled segment. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]! > 0.28;
}

/** One whole in ≤ 6 parts: a tall 28 px bar, labels inside where they fit, values always listed
 * underneath (so identity is never colour-alone and nothing depends on hover). */
export function SegmentedBar({ parts, ariaLabel }: { parts: Segment[]; ariaLabel: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div className={s.segBar} role="img" aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${p.display}`).join(", ")}`}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const pct = (p.value / total) * 100;
            return (
              <div
                key={p.key}
                className={s.seg}
                style={{ flexGrow: p.value, flexBasis: 0, background: p.color, color: isLight(p.color) ? "var(--page)" : "var(--ink)" }}
                aria-hidden
              >
                {pct >= 12 ? `${p.label} ${Math.round(pct)} %` : ""}
              </div>
            );
          })}
      </div>
      <ul className={s.segLegend}>
        {parts.map((p) => (
          <li key={p.key}>
            <span className={s.swatch} style={{ background: p.color }} aria-hidden />
            <span className={s.segName}>{p.label}</span>
            <span className={s.segValue}>{p.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
