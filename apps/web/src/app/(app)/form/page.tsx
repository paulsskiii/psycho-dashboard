import { RangeControl } from "@/components/ui/RangeControl";
import { requireOwner } from "@/lib/auth";
import { loadForm } from "@/lib/data/form";
import { parseRange } from "@/lib/range";

import s from "../analysis.module.css";
import { FormCharts } from "./FormCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Form · Psycho" };

export default async function FormPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const sb = await requireOwner();
  const data = await loadForm(sb, range.days);
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>Form</h1>
        <RangeControl value={range.key} />
      </header>
      <FormCharts data={data} days={range.days} />
    </main>
  );
}
