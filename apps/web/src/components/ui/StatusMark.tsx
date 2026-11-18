import { status } from "@psycho/tokens";

export type StatusKind = keyof typeof status | "none";

/** Status always ships as icon + label, never colour alone (spec §9.4). */
export function StatusMark({ kind, label }: { kind: StatusKind; label: string }) {
  const c = kind === "none" ? "var(--ink-2)" : status[kind];
  const icon =
    kind === "good" ? (
      <circle cx="6" cy="6" r="5" fill={c} />
    ) : kind === "warning" ? (
      <path d="M6 1 11 11H1Z" fill={c} />
    ) : kind === "serious" || kind === "critical" ? (
      <path d="M6 0.5 11.5 6 6 11.5 0.5 6Z" fill={c} />
    ) : (
      <circle cx="6" cy="6" r="4.5" fill="none" stroke={c} strokeWidth="1.5" />
    );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        {icon}
      </svg>
      <span>{label}</span>
    </span>
  );
}
