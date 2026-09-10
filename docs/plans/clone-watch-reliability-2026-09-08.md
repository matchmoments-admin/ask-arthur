# Clone Watch reliability and evidence plan — 8 September 2026

Scope: repair the seven review findings and prevent incomplete reports. Preserve
existing feature gates and notification approval flows. No outbound replay is
part of this change.

1. Replace persist_clone_alert_urlscan with an atomic verdict + lifecycle write;
   retain the last successful scan clock on misses. Keep the existing signature
   for rolling deployments. Remove redundant lifecycle calls only after v307.
2. Always drain weaponisation events, even with no retrieval work. Stamp rechecks
   only for successful submissions/classifications and propagate RPC failures.
3. Separate internal confirmation from real delivery, fix pilot report counts,
   and suppress unsupported liveness claims in both fresh and legacy snapshots.
4. Fail report preparation on missing/truncated data. Label cohort/time windows.
5. Run embedded PostgreSQL regressions, worker-handler tests, report tests,
   typecheck, lint and production build. Review downstream SQL gates explicitly.

Rollout: apply v307 before deploying the TypeScript changes. The migration is a
function replacement without data writes. Rollback uses the v230 function body
and the previous application revision together; reverting SQL alone restores
known bugs and must not be done while the new app runs.

Operational verification requires live read-only counts before/after deployment:

- likely_phishing rows in detected/monitoring/declined (split-write residue);
- weaponised_at set with weaponised_notified_at null (undrained events);
- legacy brand_notification.channel_type = shadow_summary (not real delivery);
- failed rescans with classification nonnull and submitted_at <= scanned_at;
- per-run selected/submitted/rechecked totals and oldest eligible recheck age.

Recover only evidenced affected IDs with bounded batches after inspecting vendor
and scan evidence. Do not clear notification stamps or resend brand emails in a
bulk backfill. Existing emailed monthly snapshots remain historical records;
legacy unsupported liveness text is suppressed when rendering. A multi-day soak
is required to verify operational convergence beyond local correctness tests.

## Pre-deploy audit (2026-09-08 11:58 UTC)

Read-only production aggregate: split-verdict residue 0; unemitted weaponisations
0; legacy shadow delivery stamps 0; possible failed rescans 202. Evidence review
narrowed these to 199 submit failures (leave alone) and 3 retrieve_pending misses
with non-malicious reputation: alert IDs 568, 615, 1016, each failure streak 1.
The v307 selector admits this historical evidence state without rewriting any
scan timestamp or verdict. Successful reputation-only classifications remain
excluded. The ordinary failure-streak cap still applies.

Local verification: embedded PostgreSQL executes the migration and checks atomic
rollback, failed-rescan eligibility, legacy recovery, idempotency, terminal-state
preservation and bounded failures. Worker tests cover empty-queue event draining,
failed worklists, time-budget skips, rate limits, legacy shadow stamps, confirmation
without email, and submission persistence failures. No emails were sent by tests.

## Continuation — 11 September 2026

The function replacement was applied on 8/9 September under the draft number
v303. While this PR remained open, main assigned v303–v306 to newsletter work.
This unmerged migration is therefore renumbered v307; it is the same idempotent
function replacement, not a second data migration.

Read-only follow-up: 568, 615 and 1016 now each have failure streak 3. They
re-entered retrieval and exhausted the bounded attempts; they did not produce
fresh successful scans. Their historical scan clocks remain unchanged. Do not
claim that these sites were successfully rescanned or reset their failure caps.

Rebased over main's worker time-budget fixes. Regression tests now advance the
in-step clock, matching the updated implementation. Further review found ignored
notification RPC errors: suppression failures could permit queueing, and enqueue
failures could be stamped handled. The worker now throws on directory, dedup,
suppression, enqueue and persistence failures; the inline triage path also refuses
to queue when suppression lookup fails. Added injected-failure regression tests.
