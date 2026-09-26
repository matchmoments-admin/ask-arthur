/**
 * One-off backfill for #1230: park the weak not-a-clone tail that the retired
 * clone-watch-auto-triage never reached.
 *
 * Why it exists. Auto-triage's park step read `.limit(200)` of an UNORDERED
 * set of pending NRD alerts and filtered afterwards. With 938 pending rows
 * (2026-09-26) the eligible ones mostly fell outside the 200 it saw: it
 * parked 5 on 09-23 and 0 on 09-24 and 09-25 while 48 eligible rows sat in
 * the queue (35 judged by Haiku, 13 by Jev; first seen 2026-08-25..09-25).
 * The pre-classifier now parks per batch, which covers new alerts only — so
 * the backlog needs this one pass.
 *
 * ONE write path: every page goes through `autoParkNotClones`
 * (lib/clone-watch/auto-park.ts), the function the pre-classifier batch
 * calls, so the eligibility cut, the note and the pending-only guard cannot
 * drift between the two.
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/backfill-auto-park.ts [--apply]
 *
 * Dry-run by default: prints the eligible count and a sample, writes nothing.
 * `--apply` parks. Idempotent — a second run finds nothing (the rows are no
 * longer `pending`). Reversible per row from the admin triage UI.
 */
import "./_load-env-config";
import { createServiceClient } from "@askarthur/supabase/server";

import {
  autoParkNotClones,
  isAutoParkEligible,
} from "../lib/clone-watch/auto-park";

const PAGE_SIZE = 200;

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/** Pending NRD alerts whose classification row says is_clone=false, id > cursor. */
async function fetchPage(
  sb: Sb,
  afterId: number,
): Promise<Array<{ id: number; signals: unknown }>> {
  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select("id, signals, cls:clone_watch_classifications!inner(is_clone)")
    .eq("source", "nrd")
    .eq("triage_status", "pending")
    .eq("cls.is_clone", false)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`page read failed: ${error.message}`);
  return (data ?? []) as Array<{ id: number; signals: unknown }>;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const sb = createServiceClient();
  if (!sb) throw new Error("Supabase service client unavailable (env?)");

  let cursor = 0;
  let notClone = 0;
  let eligible = 0;
  let parked = 0;
  const sample: number[] = [];

  for (;;) {
    const page = await fetchPage(sb, cursor);
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    notClone += page.length;

    const ids = page.filter((r) => isAutoParkEligible(true, r.signals)).map((r) => r.id);
    eligible += ids.length;
    if (sample.length < 10) sample.push(...ids.slice(0, 10 - sample.length));

    if (apply && ids.length > 0) {
      const out = await autoParkNotClones(sb, ids);
      if (out.error) throw new Error(`park failed after ${parked} rows: ${out.error}`);
      parked += out.parked;
      console.log(`page ending id ${cursor}: parked ${out.parked}/${ids.length}`);
    }
  }

  console.log({ pending_not_clone: notClone, eligible, parked, sample_ids: sample });
  if (!apply) console.log("\ndry-run — pass --apply to park.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
