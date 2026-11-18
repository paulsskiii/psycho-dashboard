import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

import { LabView, type Snapshot } from "./LabView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lab · Psycho" };

/** Hidden design-system bench (spec §14 Phase 3). Dev only: renders every primitive with the
 * real-data snapshot from `python -m psycho_worker lab-snapshot`. */
export default async function LabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  let snap: Snapshot | null = null;
  try {
    snap = JSON.parse(await readFile(path.join(process.cwd(), ".lab", "snapshot.json"), "utf8")) as Snapshot;
  } catch {
    snap = null;
  }
  if (!snap) {
    return (
      <main style={{ padding: 24 }}>
        <p>No lab snapshot yet. Run this on your Mac, then reload:</p>
        <pre>cd apps/worker && .venv/bin/python -m psycho_worker lab-snapshot</pre>
      </main>
    );
  }
  return <LabView snap={snap} />;
}
