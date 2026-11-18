import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadRecovery } from "@/lib/data/recovery";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { RecoveryCharts } from "./RecoveryCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery · Psycho" };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadRecovery(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Recovery</h1>
        <RangeControl value={range.key} />
      </header>
      <RecoveryCharts data={data} days={range.days} />
    </main>
  );
}
