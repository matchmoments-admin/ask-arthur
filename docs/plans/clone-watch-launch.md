# Clone-watch — launch readiness plan

**Date.** 2026-05-26. **Status.** Pre-flip review.
**Companion to.** [`clone-watch-mvp.md`](./clone-watch-mvp.md) (Layer-0 design) and [`clone-watch-outreach.md`](./clone-watch-outreach.md) (5-layer outreach design).
**Scope.** What ships before `FF_SHOPFRONT_CLONE_NOTIFY_BRAND` flips from default-OFF to ON. Everything else is post-launch.

## TL;DR

The clone-watch observability layer is **already live** — every morning at 08:30 UTC, ~70K newly-registered domains are matched against 50 AU brands and a Telegram digest lands in the admin chat with the day's hit count. Day-1 evidence (2026-05-24): 5 hits, 20% FP. The outbound brand-notification pipeline is built behind a flag (PR #451, approval-gated daily batch). Three small bundles ship before any consumer flag flip; everything else defers to post-launch hardening.

## Current state (2026-05-26)

### Pipeline (file-level map)

| Stage                              | File                                                                     | Schedule                     | Output                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **NRD ingest**                     | `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`         | `30 8 * * *` (08:30 UTC)     | UPSERT into `shopfront_clone_alerts` + Telegram digest                                                  |
| **Matcher**                        | `packages/shopfront-glue/src/lexical-match.ts` (v2)                      | inline                       | confusable / substring+token / Levenshtein scoring                                                      |
| **urlscan auto-scan**              | `apps/web/app/api/inngest/functions/clone-watch-urlscan.ts`              | event fan-out from ingest    | classify parked / likely_phishing / neutral                                                             |
| **urlscan re-scan**                | `apps/web/app/api/inngest/functions/clone-watch-urlscan-rescan.ts`       | `0 11 * * *` (11:00 UTC)     | up to 50 stale rows                                                                                     |
| **Triage UI**                      | `apps/web/app/admin/clone-watch/`                                        | operator                     | FP / TP / Investigate buttons                                                                           |
| **Notify-brand prepare** (PR #451) | `apps/web/app/api/inngest/functions/clone-watch-notify-brand-prepare.ts` | `30 9 * * *` (09:30 UTC)     | groups by (brand, recipient), renders one batch email per group, Telegram preview with HMAC approve URL |
| **Approve endpoint** (PR #451)     | `apps/web/app/api/admin/clone-watch/approve-batch/[batchId]/route.ts`    | operator taps URL            | sends batch via Resend, marks rows `sent`                                                               |
| **Weekly digest**                  | `apps/web/app/api/inngest/functions/clone-watch-weekly-digest.ts`        | `0 10 * * 0` (Sun 10:00 UTC) | LinkedIn-post draft to Telegram                                                                         |

### Feature flag state in prod

| Flag                                        | Default | Prod now                | Notes                                                                   |
| ------------------------------------------- | ------- | ----------------------- | ----------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH`                  | OFF     | **ON** since 2026-05-24 | Master switch (NRD ingest + matcher)                                    |
| `FF_SHOPFRONT_CLONE_URLSCAN`                | OFF     | OFF                     | Phase A.3 auto-classify                                                 |
| `FF_SHOPFRONT_CLONE_OUTREACH`               | OFF     | **ON** since 2026-05-26 | Admin dashboard + Layers 1–5 (per `docs/system-map/feature-flags.md`)   |
| `FF_SHOPFRONT_CLONE_NOTIFY_BRAND`           | OFF     | OFF                     | Layer 3+4 brand-direct notify                                           |
| `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND` | OFF     | OFF                     | When OFF: Telegram preview + HMAC approve. When ON: skip approval gate. |
| `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT`        | OFF     | OFF                     | Layer 2 community submission                                            |
| `FF_SHOPFRONT_CLONE_WEEKLY_DIGEST`          | OFF     | OFF                     | Layer 5 KPI digest                                                      |
| `NEXT_PUBLIC_FF_CLONE_WATCH_PUBLIC`         | —       | noindex'd               | Public `/clone-watch` page (gated until #371 lawyer copy)               |

## Acceptance criteria for `FF_SHOPFRONT_CLONE_NOTIFY_BRAND=ON`

User-stated 2026-05-26:

> One email per brand per day with N+ verified scam/clone links, gated by my manual approval.

Restated as testable conditions:

1. **Batching.** All hits for the same `(brand_slug, recipient_email)` collapse into a single email in the daily 09:30 UTC cron run. Verified by the existing `groupByBrandRecipient` test in `apps/web/__tests__/cloneWatchOutreach.test.ts:604`.
2. **Operator-in-the-loop.** With `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND=OFF` (current default and required state for launch), every batch produces a Telegram preview with an HMAC approve URL. No email leaves Resend without an admin tap. HMAC integrity is covered by 8 round-trip tests including tampering attacks.
3. **Idempotency.** Re-running the prepare cron the same day MUST NOT produce duplicate emails. Guarded by `list_clone_alerts_unbatched_for_prepare` RPC (filters out rows with `batch_id IS NOT NULL`). **Gap: no regression test.** See PR-Launch-1 below.
4. **Kill-switch.** With `FF_SHOPFRONT_CLONE_NOTIFY_BRAND=OFF`, the prepare cron exits at the flag check before any DB query, Telegram send, or Resend call. The flag check is at the top of the function and obvious in code review.
5. **FP gate.** Matcher FP rate stays <30% (locked v2-onward acceptance). #409 v3 patch ships before flip — current matcher has a known leak (`au` token mid-word: `autoecolesoultbycfconduite.fr` matches Coles).
6. **HMAC secret configured.** PR #451's `clone-watch-approve.ts` reads `CLONE_WATCH_APPROVAL_SECRET ?? ADMIN_SECRET`. `ADMIN_SECRET` is already set in prod (other admin endpoints depend on it), so this is a confirmation step, not a blocker. Verify before the first morning Telegram tap: a missing secret returns the `"CLONE_WATCH_APPROVAL_SECRET / ADMIN_SECRET not configured"` error to the operator. One-liner check on prod: `vercel env ls production | grep -E 'ADMIN_SECRET|CLONE_WATCH_APPROVAL_SECRET'`.
7. **Brand-notify email body — copy review.** The outbound email is cold unsolicited contact to a third-party brand's published abuse/security/legal address. Lower legal risk than the public `/clone-watch` page (recipient is the brand itself, not the alleged clone), but the body should still be reviewed for: (a) no defamatory claim about the clone domain ("appears to be" / "possible clone" — not "fraudulent"); (b) clear opt-out / suppression path (already wired via v146 suppression schema); (c) sender identification (Ask Arthur as observer, not enforcement agent). Treat as a content-review gate, not a legal-counsel gate — read the rendered template in `apps/web/emails/CloneWatchBrandAlert.tsx` once before flag flip.

## 3-PR launch plan

### PR #451 — daily-batch approval flow

**Status: OPEN, all CI green, ready to merge.** Migration v151 already applied to prod.

Validation step after merge (next morning ops):

1. Fire `shopfront/clone.notify-brand-prepare.manual-trigger.v1` from Inngest cloud
2. Confirm Telegram preview lands in admin chat with rendered email body in `<pre>` block and HMAC approve URL
3. Tap Approve → confirmation page returns 200, Resend sends the email, rows transition to `sent`
4. Repeat for one (brand, recipient) group to confirm grouping math is correct on real data

### PR-Launch-1 (must, ~1 day) — `#409 + #412 + idempotency regression test`

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                             | File                                                               | LoC est |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| **#409** v3 matcher — word-boundary check on `au` context token                                                                                                                                                                                                                                                                                                                                                                                    | `packages/shopfront-glue/src/lexical-match.ts` + test              | ~40     |
| **#412 Sprint 1** — new **parallel** `shopfront_clone_watch` aggregate brake (NOT folded into `shopfront_clone_outreach` — different cost drivers, different failure modes). New `SHOPFRONT_CLONE_WATCH_CAP_USD` env var (placeholder cap `A$1/day`). New enumeration block in `cost-daily-check` (exact-match on `shopfront_clone_watch` feature label only at MVP; Phase A adds DNS/screenshot labels). Idempotent seed of `feature_brakes` row. | migration v152 + `apps/web/app/api/cron/cost-daily-check/route.ts` | ~50     |
| **Regression test** — re-running prepare cron same day produces zero new batches                                                                                                                                                                                                                                                                                                                                                                   | `apps/web/__tests__/cloneWatchOutreach.test.ts`                    | ~25     |

Acceptance: matcher FP rate stays below 30% on a 100-NRD synthetic set including `autoecolesoultbycfconduite.fr` and similar `au` mid-word noise; cost brake row visible in `feature_brakes` query; prepare cron re-run test green.

### PR-Launch-2 (should, ~0.5 day) — approve/reject endpoint tests

Current state: HMAC helper has 8 round-trip tests. Endpoints at `apps/web/app/api/admin/clone-watch/{approve,reject}-batch/[batchId]/route.ts` have zero test files.

| Test                                       | What it proves                                              |
| ------------------------------------------ | ----------------------------------------------------------- |
| Approve with valid HMAC + matching batchId | 200, Resend called once, rows transition `pending` → `sent` |
| Approve with tampered batchId              | 401                                                         |
| Approve already-sent batch                 | 200 + idempotent no-op (no second Resend call)              |
| Reject with valid HMAC                     | 200, rows transition to `rejected`, no Resend call          |
| Approve when Resend errors                 | error surfaces, rows stay `pending` for retry               |

Defensible without it. Worth the half-day because every approve URL is a customer-facing email at the end of a one-shot click.

## Deferred to post-launch backlog

Closed today:

- **#430** Phase C inbound brand-reply handler — closed with 30-day revisit gate (3+ manual replies → build; 0–2 → wontfix). Outbound suppression schema (v146) already shipped.
- **#445** sendResult → emailResponse rename — closed; fold into next touching PR.

Stay severity:p3 in backlog (no relabel — already correctly classified):

- **#406** soft-expiry rule — body says defer until ~10K rows. At 17/day, that's 2 years.
- **#426** Netcraft TERMINAL_STATES observability — won't bite at MVP volume.
- **#427** TOAST sibling for `netcraft.last_checked_at` — body says "fine at current scale".
- **#428** handler-level Inngest tests — helpers covered; handler tests nice-to-have.
- **#429** stale `brand_notification_queued` dashboard — backlog widget.
- **#434** urlscan evidence history JSONB — operator nice-to-have.
- **#439** `isHttpsUrlscanUrl` suffix tightening — CSP whitelist mitigates.
- **#440** `merge_clone_alert_submission` never-demote guard — defense-in-depth.
- **#442** RPC p_key whitelist — defense-in-depth.
- **#443** admin scan rate-limit fix — admin-only surface.
- **#444** `body_excerpt` table-level CHECK — gated on #430 shipping.

Already correctly gated:

- **#411** public-social outreach loop — gated on #371 lawyer copy.
- **#447** docs/CLAUDE.md updates — ready-for-agent; ship pre-launch if cheap, else fold into PR-Launch-1 commit.

## Bumped to launch-blocking

- **#409** v3 matcher `au` word-boundary — severity:p1. Day-1 leak evidence in this doc.
- **#412** cost + safety guardrails (Sprint 1 only) — severity:p1.

## Flag-flip order (post-PRs)

1. Merge PR #451 → run validation step above the next morning. Lock confidence in the approval template.
2. Ship PR-Launch-1 → re-verify Day-N FP rate stays <30%.
3. Ship PR-Launch-2 (optional).
4. ~~Flip `FF_SHOPFRONT_CLONE_OUTREACH=ON`~~ — **already ON in prod since 2026-05-26.** Admin dashboard is live; no outbound yet because notify-brand flag is still OFF.
5. Flip `FF_SHOPFRONT_CLONE_URLSCAN=ON` (auto-classify enriches dashboard).
6. After 2–3 days of triage practice on real urlscan-classified data:
7. Flip `FF_SHOPFRONT_CLONE_NOTIFY_BRAND=ON`. Auto-send stays OFF — every batch needs operator tap.
8. After 30 days of pilot:
   - Re-evaluate #430 inbound replies
   - Consider `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND=ON` only if false-batch rate is ≤5%
   - Flip `FF_SHOPFRONT_CLONE_WEEKLY_DIGEST=ON`
   - Flip `NEXT_PUBLIC_FF_CLONE_WATCH_PUBLIC` after #371 lawyer copy lands

## Out of scope (not part of "launch")

- Phase B CT firehose (gated on 10+ paying Shield Pro merchants per ADR-0016)
- Phase C Voyage embeddings + Hetzner (gated on Layer 4 WTP + #369)
- LinkedIn auto-draft posting (Layer 5 manual copy-paste in v1)
- Mobile clone-watch surface
- B2B `/api/v1/shopfront/*` endpoints
