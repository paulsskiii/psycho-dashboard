import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadBody } from "@/lib/data/body";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { BodyCharts } from "./BodyCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Body · Psycho" };

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadBody(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Body</h1>
        <RangeControl value={range.key} />
      </header>
      <BodyCharts data={data} days={range.days} />
    </main>
  );
}
