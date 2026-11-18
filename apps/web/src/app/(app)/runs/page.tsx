import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { SPORTS, listActivities, parseSport } from "@/lib/data/runs";

import a from "../analysis.module.css";
import { RunsList } from "./RunsList";
import s from "./runs.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activities · Psycho" };

const LABEL = { all: "All", run: "Runs", ride: "Rides", strength: "Strength", walk: "Walks" } as const;

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const sport = parseSport((await searchParams).sport);
  const sb = await requireOwner();
  const first = await listActivities(sb, sport);
  return (
    <main className={a.page}>
      <header className={a.head}>
        <h1 className={`display ${a.title}`}>Activities</h1>
        <nav aria-label="Filter by sport" className={s.filters}>
          {SPORTS.map((k) => (
            <Link
              key={k}
              href={k === "all" ? "/runs" : `/runs?sport=${k}`}
              className={s.filter}
              aria-current={k === sport ? "page" : undefined}
              scroll={false}
            >
              {LABEL[k]}
            </Link>
          ))}
        </nav>
      </header>
      <RunsList key={sport} sport={sport} initial={first.rows} initialNext={first.next} failed={first.failed} />
    </main>
  );
}
