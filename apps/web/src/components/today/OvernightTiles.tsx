"use client";

import { useCallback, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { StatTile, type Source } from "@/components/ui/StatTile";

export type Tile = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  spark: (number | null)[];
  source: Source;
};

/** Plain-English definition, how it's made, and what data it used (spec §7). */
const INFO: Record<string, { title: string; body: string[] }> = {
  hrv: {
    title: "Overnight HRV",
    body: [
      "Your average heart-rate variability while asleep, in milliseconds. Higher than your normal usually means you've recovered.",
      "Measured by your watch. Your normal is your own average over the previous 28 nights.",
    ],
  },
  rhr: {
    title: "Resting heart rate",
    body: [
      "Your lowest steady heart rate of the day, in beats per minute. A few beats above your normal can mean fatigue, illness, heat or a late meal.",
      "Measured by your watch.",
    ],
  },
  sleep: {
    title: "Sleep score",
    body: ["Garmin's 0–100 rating of last night's sleep: duration, stages, restlessness and stress while asleep.", "Measured by your watch."],
  },
  bb: {
    title: "Body Battery at wake",
    body: ["Garmin's 0–100 energy estimate at the moment you woke up. It charges while you rest and drains with activity and stress.", "Measured by your watch."],
  },
  sleeptime: {
    title: "Sleep time",
    body: ["How long you slept last night, not counting time awake.", "Measured by your watch."],
  },
  stress: {
    title: "Stress",
    body: ["Garmin's average stress level for the day, 0–100, from heart-rate variability while you're not exercising. Lower is calmer.", "Measured by your watch."],
  },
};

export function OvernightTiles({ tiles, className }: { tiles: Tile[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const info = open ? INFO[open] : null;
  return (
    <>
      <div className={className}>
        {tiles.map(({ key, ...t }) => (
          <StatTile key={key} {...t} onOpen={() => setOpen(key)} />
        ))}
      </div>
      <BottomSheet open={info != null} title={info?.title ?? ""} onClose={close}>
        {info?.body.map((p) => <p key={p}>{p}</p>)}
      </BottomSheet>
    </>
  );
}
