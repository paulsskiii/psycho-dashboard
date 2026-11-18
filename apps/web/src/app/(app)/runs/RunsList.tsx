"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { color, sport as sportColor } from "@psycho/tokens";

import { projectRoute } from "@/components/today/RouteLine";
import type { ListRow } from "@/lib/data/runs";
import * as f from "@/lib/format";

import { loadMore } from "./actions";
import s from "./runs.module.css";

const SPORT_NAME = { run: "Run", ride: "Ride", strength: "Strength", walk: "Walk", other: "Other" } as const;

function Thumb({ row }: { row: ListRow }) {
  const p = row.has_gps ? projectRoute(row.route, 0.12) : null;
  const c = sportColor[row.sport === "run" || row.sport === "ride" || row.sport === "strength" ? row.sport : "other"];
  return (
    <span className={s.thumb} aria-hidden>
      {p ? (
        <svg viewBox={p.viewBox} preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
          <path d={p.d} fill="none" stroke={color.ink} strokeOpacity={0.85} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <span className={s.noGps} style={{ background: c }} />
      )}
    </span>
  );
}

function Row({ row }: { row: ListRow }) {
  const isRun = row.sport === "run";
  const pace = isRun && row.avg_speed_mps ? 1000 / row.avg_speed_mps : null;
  const km = row.distance_m && row.distance_m > 300 ? `${f.num(row.distance_m / 1000, 1)} km` : null;
  const load = row.hrtss == null ? "–" : `${row.hrtss_estimated ? "~" : ""}${f.num(row.hrtss)}`;
  return (
    <li>
      <Link href={`/activity/${row.id}`} className={s.row}>
        <Thumb row={row} />
        <span className={s.main}>
          <span className={s.name}>{row.name ?? SPORT_NAME[row.sport]}</span>
          <span className={s.date}>
            {f.day(row.start_local)}
            {row.indoor && row.sport !== "strength" ? ", indoor" : ""}
          </span>
        </span>
        <span className={s.cell} data-label="Distance">{km ?? "–"}</span>
        <span className={s.cell} data-label="Time">{f.duration(row.duration_s)}</span>
        <span className={s.cell} data-label="Pace">{pace ? f.pace(pace) : "–"}</span>
        <span className={s.cell} data-label="Avg HR">{row.avg_hr ? `${row.avg_hr} bpm` : "–"}</span>
        <span className={s.cell} data-label="Load" title={row.hrtss_estimated ? "Estimated from duration: no heart-rate data" : undefined}>
          {load}
        </span>
        <span className={s.cell} data-label="TE">{f.num(row.aerobic_te, 1)}</span>
      </Link>
    </li>
  );
}

export function RunsList({
  sport,
  initial,
  initialNext,
  failed,
}: {
  sport: string;
  initial: ListRow[];
  initialNext: string | null;
  failed: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [error, setError] = useState(failed);
  const [pending, start] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || pending || !next) return;
        start(async () => {
          const page = await loadMore(sport, next);
          setError(page.failed);
          if (!page.failed) {
            setRows((r) => [...r, ...page.rows]);
            setNext(page.next);
          }
        });
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [next, pending, sport]);

  if (!rows.length) {
    return (
      <section className={s.band}>
        <p className={s.empty}>
          {error
            ? "Couldn't load your activities. Check your connection and reload."
            : sport === "ride"
              ? "No rides yet. Your first ride will show up here after it syncs."
              : "Nothing here yet. Activities show up here after your watch syncs."}
        </p>
      </section>
    );
  }

  return (
    <section className={s.band} aria-label="Activities, newest first">
      <div className={s.headRow} aria-hidden>
        <span />
        <span>Activity</span>
        <span>Distance</span>
        <span>Time</span>
        <span>Pace</span>
        <span>Avg HR</span>
        <span>Load</span>
        <span>TE</span>
      </div>
      <ol className={s.list}>
        {rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ol>
      <div ref={sentinel} className={s.more} aria-live="polite">
        {next ? (pending ? "Loading more…" : "") : `That's everything: ${rows.length} activities.`}
        {error && rows.length ? " Couldn't load more. Scroll to try again." : ""}
      </div>
    </section>
  );
}
