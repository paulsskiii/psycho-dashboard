import { notFound } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { loadActivity } from "@/lib/data/activity";

import { ActivityView } from "./ActivityView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity · Psycho" };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const sb = await requireOwner();
  const data = await loadActivity(sb, Number(id));
  if (!data) notFound();
  return <ActivityView data={data} />;
}
