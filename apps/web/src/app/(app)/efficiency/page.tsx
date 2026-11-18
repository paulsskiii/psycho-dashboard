import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadEfficiency } from "@/lib/data/efficiency";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { EfficiencyCharts } from "./EfficiencyCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Efficiency · Psycho" };

export default async function EfficiencyPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadEfficiency(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Efficiency</h1>
        <RangeControl value={range.key} />
      </header>
      <EfficiencyCharts data={data} days={range.days} />
    </main>
  );
}
