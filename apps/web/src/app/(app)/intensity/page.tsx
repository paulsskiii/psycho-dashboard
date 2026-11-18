import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadIntensity } from "@/lib/data/intensity";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { IntensityCharts } from "./IntensityCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intensity · Psycho" };

export default async function IntensityPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadIntensity(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Intensity</h1>
        <RangeControl value={range.key} />
      </header>
      <IntensityCharts data={data} days={range.days} />
    </main>
  );
}
