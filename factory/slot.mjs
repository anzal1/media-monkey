/*
 * slot.mjs — which posting slot this run is for, as an exact instant.
 *
 * GitHub's scheduler starts our runs three to five hours late (measured over
 * the last few weeks), so a cron line can no longer BE the posting time. Each
 * cron now fires SLOT_LEAD before its slot; the render happens whenever GitHub
 * gets round to it, and the post waits for the slot. The slot is the most
 * recent instant matching the cron's hh:mm, plus the lead. Delays under a day
 * are handled; a manual run gets "now".
 *
 *   node factory/slot.mjs "<cron expression>"   -> prints an ISO instant
 */
export const SLOT_LEAD_MS = 5.5 * 3600 * 1000;

export function slotFor(cron, now = new Date()) {
  const m = /^(\d+)\s+(\d+)\s/.exec(String(cron || '').trim());
  if (!m) return now;
  const nominal = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[2], +m[1]));
  if (nominal > now) nominal.setUTCDate(nominal.getUTCDate() - 1);
  return new Date(nominal.getTime() + SLOT_LEAD_MS);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(slotFor(process.argv[2]).toISOString());
}
