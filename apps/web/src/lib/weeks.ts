import { toDate } from "./format";

/** Monday (Manila calendar) of the week containing a YYYY-MM-DD or local ISO timestamp. */
export function weekKey(d: string): string {
  // Manila midnight shifted +8 h so the UTC fields read as the Manila calendar date.
  const local = new Date(+toDate(d.slice(0, 10)) + 8 * 3600e3);
  const monday = new Date(+local - ((local.getUTCDay() + 6) % 7) * 86400e3);
  return monday.toISOString().slice(0, 10);
}
