import Link from "next/link";

import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadSports } from "@/lib/data/sports";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { SportsCharts } from "./SportsCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sports · Psycho" };

export default async function SportsPage({ searchParams }: { searchParams: Promise<{ range?: string; tab?: string }> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const sb = await requireOwner();
  const data = await loadSports(sb, range.days);
  // Default to the tab that has data in the range (no rides yet → Strength).
  const hasRides = data.sessions.some((x) => x.sport === "ride");
  const tab = sp.tab === "ride" || sp.tab === "strength" ? sp.tab : hasRides ? "ride" : "strength";
  const href = (t: string) => `/sports?tab=${t}&range=${range.key}`;
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Sports</h1>
        <RangeControl value={range.key} />
      </header>
      <div className={s.tabs}>
      <nav className={s.seg} aria-label="Sport">
        <Link href={href("ride")} aria-current={tab === "ride" ? "page" : undefined} prefetch={false} scroll={false}>
          Ride
        </Link>
        <Link href={href("strength")} aria-current={tab === "strength" ? "page" : undefined} prefetch={false} scroll={false}>
          Strength
        </Link>
      </nav>
      </div>
      <SportsCharts data={data} days={range.days} tab={tab} />
    </main>
  );
}
