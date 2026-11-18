// Runs the spec's palette checks (Appendix B.4) against tokens.json. Exits non-zero on any FAIL.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "..", "tokens.json"), "utf8"));
const surface = t.color.surface;
const s = t.data.sport;
const sl = t.data.sleep;

const runs = [
  ["sports (categorical)", [s.run, s.ride, s.strength, s.other], []],
  ["sleep stack order", [sl.deep, sl.light, sl.rem, sl.awake], []],
  ["first 3 sports, all pairs", [s.run, s.ride, s.strength], ["--pairs", "all"]],
  ["HR zones (ordinal)", t.data.zones, ["--ordinal"]],
];

let failed = false;
for (const [label, colors, extra] of runs) {
  const out = execFileSync(
    "node",
    [join(here, "validate_palette.js"), colors.join(","), "--mode", "dark", "--surface", surface, ...extra],
    { encoding: "utf8" },
  );
  const fail = /\[FAIL\]/.test(out);
  failed ||= fail;
  console.log(`${fail ? "FAIL" : "PASS"}  ${label}`);
  if (fail) console.log(out);
}
process.exit(failed ? 1 : 0);
