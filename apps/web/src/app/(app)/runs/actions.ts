"use server";

import { requireOwner } from "@/lib/auth";
import { listActivities, parseSport } from "@/lib/data/runs";

/** Next page for infinite scroll. Re-verifies the owner on every call. */
export async function loadMore(sport: string, before: string) {
  const sb = await requireOwner();
  return listActivities(sb, parseSport(sport), before);
}
