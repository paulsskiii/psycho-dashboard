import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadRaces } from "@/lib/data/races";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { RacesCharts } from "./RacesCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Races · Psycho" };

export default async function RacesPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadRaces(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Races</h1>
        <RangeControl value={range.key} />
      </header>
      <RacesCharts data={data} days={range.days} />
    </main>
  );
}
