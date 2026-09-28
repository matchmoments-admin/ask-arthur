/**
 * `pipeline-urlscan-enrichment`'s schedule and per-run cap — the ONE copy.
 *
 * The lane lives in scam-engine, which cannot import the app-side urlscan
 * budget (apps/web/lib/clone-watch/urlscan-budget.ts). So the declaration sits
 * here, the lane's trigger and loop read it, and the budget imports it into
 * its roster of UNLISTED urlscan spenders. Moving the cron or raising the cap
 * therefore changes the budget's arithmetic too, and
 * apps/web/__tests__/urlscanBudget.test.ts fails if an hour or the day no
 * longer fits.
 *
 * 03:00 / 15:00 / 21:00 UTC — off the clone-watch recheck's :30 hours and the
 * 09:00 submit (#1231: a 90-scan recheck at 00:30 plus this lane's 20 breached
 * urlscan's 100/hour when this ran at `30 *\/8`).
 */
export const URLSCAN_ENRICHMENT_CRONS = ["0 3,15,21 * * *"] as const;

/** Worst-case unlisted urlscan submits in one run (one per URL entity). */
export const URLSCAN_ENRICHMENT_MAX_PER_RUN = 20;
