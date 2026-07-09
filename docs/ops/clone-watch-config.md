# Clone-watch (Layer 0) — Operational Config Checklist

**Purpose.** Single source of truth for every env var, feature flag,
verification SQL, cost-telemetry tag, and operator runbook step that the
Layer 0 clone-watch surface depends on. If a flag needs flipping, a
suspect run needs verifying, or rows need wiping for a re-run — it goes
here.

Referenced from [CLAUDE.md](../../CLAUDE.md) Quick Reference and from
[docs/plans/clone-watch-mvp.md](../plans/clone-watch-mvp.md). Keep updated
each PR.

> **Status (2026-05-24, post-PR #408).** Layer 0 LIVE in prod.
> `FF_SHOPFRONT_CLONE_WATCH=true`. v2 matcher (scam-context-token gate)
> shipped. Day-1 verification: 5 hits / 20% FP / 4 brands → passes the
> <30% FP + ≥3 daily-hits acceptance gate. v3 follow-up [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409)
> tracks the `au`-token mid-word leak (`autoecolesoultbycfconduite.fr`
> class). Page `/clone-watch` rendering with `noindex,nofollow` until #371
> v1 lawyer-vetted copy returns.

**Status legend**

| Marker | Meaning                           |
| ------ | --------------------------------- |
| ✅     | Live / configured / shipped       |
| ⏳     | In progress this sprint           |
| ❌     | Not started                       |
| 🔒     | Blocked — waiting on external dep |

---

## 1. Feature flag

| Flag (env var)             | Type   | Default | Status | Gates                                                                                                                                                                                                                                                                            | Flip when                                                                                           |
| -------------------------- | ------ | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH` | server | `false` | ✅     | Master switch on the `shopfront-nrd-daily-ingest` Inngest function. When `false`, the function short-circuits before downloading the NRD zip and emits no telemetry. When `true`, the daily 08:30 UTC run downloads, parses, matches, and inserts into `shopfront_clone_alerts`. | After PR #398 ship + post-merge smoke. Currently ON in prod since 2026-05-24 (flag flip + 1st run). |

The page surface (`apps/web/app/clone-watch/page.tsx`) reads from the
table directly and does NOT consult the flag — flipping the flag back to
`false` stops new rows from landing but the page continues to render the
last successful run's data. To blank the surface entirely, flip the flag
AND truncate `WHERE source='nrd'`.

---

## 2. Environment variables

| Var                        | Status | Where set                      | Notes                                                                                                                                                                                               |
| -------------------------- | ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH` | ✅     | Vercel → Production            | Master flag. Flipped ON 2026-05-24.                                                                                                                                                                 |
| `WHOISDS_NRD_ZIP_URL`      | (none) | Vercel → Production (optional) | **Optional override**. PR #400 made the URL deterministic via `computeNrdUrl(yesterdayUtc())`. Leave unset in normal ops; only set when back-filling a specific historical date or swapping source. |
| `INNGEST_EVENT_KEY`        | ✅     | Vercel → Production            | Already provisioned (used by every other Inngest function). Required by the manual-trigger curl in §5.                                                                                              |
| `TELEGRAM_ADMIN_CHAT_ID`   | ✅     | Vercel → Production            | Already provisioned (used by other digests). Receives the per-run digest "Today's clone-watch: N hits across M brands."                                                                             |

No new third-party API keys. whoisds.com NRD daily zip is free-tier,
no-auth, deterministic-URL.

---

## 3. Cost-telemetry tag

| Tag (snake_case)              | Cost               | Notes                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopfront_clone_watch`       | A$0/mo (free tier) | Successful daily run. Metadata: `{ hits_found: N, rows_inserted: M, brands_with_hits: K, duration_ms: T }`. **Distinct from `shopfront_clone_scan`** (Phase A future scope — installed-merchant scanner). The hyphen-to-underscore convention matches `phone_footprint`, `reddit_intel`, `charity_check`, `vuln_au_enrichment`. |
| `shopfront_clone_watch_error` | A$0                | Per-step failure inside the Inngest function. Triggers Telegram page.                                                                                                                                                                                                                                                           |

No `feature_brakes.shopfront_clone_watch` row exists or is needed at MVP —
whoisds is free, the run produces A$0 marginal spend per execution.

---

## 4. Verification SQL queries

These are the operationally important pieces. Copy-paste against the
Supabase prod project (`rquomhcgnodxzkhokwni`) via `mcp__supabase__execute_sql`
or the dashboard SQL editor.

### Daily hit count + acceptance-gate floor check

The acceptance gate requires ≥3 daily hits (the "floor" — distinguishes
a tighter matcher from a silenced one) AND <30% FP rate.

```sql
-- Daily hit count + distinct brand-coverage over the last 7 days
SELECT date_trunc('day', first_seen_at) AS day,
       COUNT(*) AS hits,
       COUNT(DISTINCT inferred_target_domain) AS distinct_brands
FROM public.shopfront_clone_alerts
WHERE source='nrd' AND first_seen_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

A day with `hits < 3` is a floor breach — investigate whether the matcher
silently over-tightened or whoisds dropped the zip. The FP-rate side of
the gate is eyeball-verified against the per-brand ledger below.

### Per-brand alert ledger (FP spot-check)

The right shape for the daily 5-minute eyeball pass — review each row
against your knowledge of the brand and flag obvious FPs (real businesses,
common-word collisions).

```sql
-- Per-brand alert ledger for FP spot-check
SELECT inferred_target_domain AS brand,
       candidate_domain,
       signals->0->>'signal_type' AS signal_type,
       signals->0->>'score' AS score,
       severity_tier,
       first_seen_at
FROM public.shopfront_clone_alerts
WHERE source='nrd'
ORDER BY inferred_target_domain, candidate_domain;
```

To narrow to a single day's run:

```sql
WHERE source='nrd' AND first_seen_at >= date_trunc('day', now())
```

### Telemetry — hits found vs rows inserted per run

UPSERT idempotency means `hits_found` (matcher output) is normally ≥
`rows_inserted` (rows actually new vs touching an existing
`(inferred_target_domain, url_hash)` row). A widening gap over multiple
days suggests the matcher is re-finding stable candidates from the same
brand-set; a narrowing gap suggests the underlying NRD universe is
churning faster.

```sql
SELECT created_at,
       metadata->>'hits_found' AS hits,
       metadata->>'rows_inserted' AS rows_inserted,
       metadata->>'brands_with_hits' AS brands_with_hits,
       metadata->>'duration_ms' AS duration_ms
FROM public.cost_telemetry
WHERE feature='shopfront_clone_watch'
ORDER BY created_at DESC
LIMIT 10;
```

### Error telemetry

If the Telegram digest didn't land or a step failed, this is the first
query.

```sql
SELECT created_at, metadata
FROM public.cost_telemetry
WHERE feature='shopfront_clone_watch_error'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 5. Operator runbook

### Manual ad-hoc trigger

The event-trigger path (PR #402) is the cleanest way to fire an ad-hoc
run between cron ticks — for back-fills, post-fix verifications, or
demos. Bypasses the Inngest dashboard.

```bash
# 1. Pull INNGEST_EVENT_KEY from Vercel (one-shot, no persistence):
ENV_ID=$(curl -sS -H "Authorization: Bearer $VCTOKEN" \
  "https://api.vercel.com/v9/projects/prj_U3DtIAy2zEzrYrsXwUFCiZ2t54Bp/env?decrypt=false" \
  | python3 -c "import sys,json; [print(e['id']) for e in json.load(sys.stdin)['envs'] if e['key']=='INNGEST_EVENT_KEY' and 'production' in e['target']]")
KEY=$(curl -sS -H "Authorization: Bearer $VCTOKEN" \
  "https://api.vercel.com/v1/projects/prj_U3DtIAy2zEzrYrsXwUFCiZ2t54Bp/env/$ENV_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")

# 2. Fire the manual-trigger event:
curl -X POST "https://inn.gs/e/$KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"shopfront/nrd.manual-trigger.v1","data":{"source":"ops-runbook"}}'
```

Alternative: Inngest dashboard → app `askarthur` → fn
`shopfront-nrd-daily-ingest` → "Invoke".

### Wipe rows + re-fire (post-matcher-change verification flow)

Used after shipping a matcher-side PR (#403, #408, future #409 v3) to
get a clean ledger.

```sql
-- Wipe (CAREFUL — drops the daily ledger for source='nrd' only)
DELETE FROM public.shopfront_clone_alerts WHERE source='nrd';
```

Then re-fire via the manual-trigger curl above. Wait ≤5 min for the
Inngest run to complete, then run the verification SQL in §4 to compute
the new hit count / FP rate.

This flow is safe at MVP because `source='nrd'` rows are reproducible
from yesterday's NRD zip + the current matcher. It is NOT safe once
Phase A's `source='corpus'` writes start because those rows have
historical provenance the corpus search no longer re-derives.

### Flag flip back to OFF

If the matcher misbehaves (FP rate breaches 30% on a single run, or the
public page shows defamation-risk language):

1. Set `FF_SHOPFRONT_CLONE_WATCH=false` in Vercel → Production. Vercel
   auto-redeploys.
2. Cron stops firing on the next 08:30 UTC tick. Today's rows remain on
   the page (the page reads the table, not the flag).
3. To blank the page, `DELETE FROM shopfront_clone_alerts WHERE
source='nrd'` after the flag is OFF.

### Pre-flip checklist for a matcher-change PR

Every PR that touches `packages/shopfront-glue/src/lexical-match.ts` must
walk through this before merge:

- [ ] `pnpm turbo build` + `pnpm --filter @askarthur/shopfront-glue test` green
- [ ] `/local-ultrareview <PR#>` clean
- [ ] Migration (if any) applied to prod via `mcp__supabase__apply_migration` + `mcp__supabase__get_advisors` no new ERRORs
- [ ] Vercel preview build green
- [ ] Post-merge: wipe `source='nrd'` rows + manual-trigger fire + verification SQL → FP <30% + hits ≥3 (the locked acceptance gate)

If the post-merge run fails the acceptance gate, the PR is rolled back
(revert + redeploy) before the next cron tick.

---

## 6. Acceptance gate (locked, v2 matcher onward)

Per ADR-0017 and the matcher evolution log in
`docs/plans/clone-watch-mvp.md`:

1. **FP rate <30%** on the daily NRD run (eyeball-verified against the
   per-brand ledger SQL in §4).
2. **Daily hit count ≥3** ("the floor"). A matcher that silences itself
   to 0 hits is a regression, not an improvement.

Any future matcher iteration that breaches either gate on the post-merge
verification run is rolled back. Both gates apply to every iteration —
v3, v4, etc.

---

## 8. Outreach + measurement ops (Layers 1–5 + Phase A.3)

Shipped across PRs #424 / #425 / #431 / #432 / #433; hardened across #468 / #469 / #475 / #476 / #482–#489 (admin-auth + bank-channel routing + inline-enqueue + URLscan-embedded evidence). The pipeline turns Layer 0 daily NRD hits into community-blocklist submissions + brand-team notifications + auto-classified screenshots, with a daily batch-builder + admin-click approval before any email leaves the platform.

### Operator dashboard

[`/admin/clone-watch`](https://askarthur.au/admin/clone-watch) shows three views:

1. **Triage queue** — pending alerts with FP / TP / Investigate buttons, per-row urlscan classification chip (parked / unresolved / likely phishing / resolves) + screenshot thumbnail + "Scan now" / "Re-scan". Bulk-select supports per-brand actions; selection persists across reloads via sessionStorage (PR #474).
2. **#approvals tab** — batches in `pending` state with frozen subject + html preview + Send / Reject. One row per (brand, recipient, batch_id).
3. **Per-brand history + Netcraft takedown stats** — 30-day window, median / P90 time-to-takedown.

### Daily op cadence

- **08:30 UTC** — `shopfront-nrd-daily-ingest` runs (Layer 0), inserts hits into `shopfront_clone_alerts`, fans out scan-requested events.
- **~08:32 UTC** — urlscan auto-scans complete (~90s/row × concurrency 3). Most rows arrive in the dashboard with a classification + screenshot already attached.
- **5-min triage pass** — operator opens `/admin/clone-watch`, eyeballs screenshots, marks FP / TP / Investigate. Auto-classified `parked_for_sale` + `unresolved` rows have already been moved to `needs_investigation` and dropped off the pending queue.
  - **On TP**: triage route inline-enqueues into `clone_alert_notification_queue` for `fraud_inbox` / `security_txt` brands (PR #488), stamps `submitted_to.brand_notification = {status:'skipped'}` for dashboard parity (PR-A 2026-05-28), then emits `shopfront/clone.triaged.v1` with bounded retry. On retry exhaustion the admin is Telegram-paged and the dashboard surfaces `eventEmitted:false` as a yellow toast (PR #487).
  - When `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT=true` + `NETCRAFT_REPORT_API_KEY` set, `shopfront-clone-submit-netcraft` fires (~30 sec) as part of the fan-out.
- **09:30 UTC** — `shopfront-clone-notify-brand-prepare` runs (daily batch builder). Groups queue rows by (brand, recipient), filters via 24h cooldown, caps each group at 50 candidates, fetches `urlscan_evidence` per alert (link + screenshot), renders React Email, freezes subject + html on the queue, transitions to `pending`. Posts ONE summary Telegram pointing the admin at `/admin/clone-watch#approvals`. When `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND=true`, dispatches via Resend on the same tick instead of waiting for admin click.
- **Admin clicks Send** at `/admin/clone-watch#approvals` → `POST /api/admin/clone-watch/batches/[batchId]/send`. Pre-checks (FF + brake + RESEND_FROM_EMAIL), cross-validates recipient against `brand_contact_directory.brand` PK, re-checks STOP suppression, Resend send with `idempotencyKey: clone-watch-send:{batchId}`, transitions batch, records send (stamps `last_notified_at` + `submitted_to.brand_notification.status='sent'`).
- **11:00 UTC** — urlscan re-scan cron (`shopfront-clone-urlscan-rescan`) catches up to 50 stale rows (60-day window). Catches the parked → activated transition.
- **10:00 UTC** — `shopfront-clone-netcraft-reconcile` (v217, gated `FF_CLONE_LIFECYCLE_RECONCILE`) reads the PER-URL truth from `GET /submission/{uuid}/urls` and advances each submitted clone's `lifecycle_state` by its own `url_state` (`malicious→taken_down` + witnessed `takedown_at`; `no threats`/`unavailable→declined`). This is the single Netcraft verdict source.
- **11:00 UTC** — `shopfront-clone-netcraft-issue` (v215/v216, gated `FF_CLONE_NETCRAFT_ISSUE`) files a false-negative `report_issue` on branded `no threats` clones (dry-run until `NETCRAFT_ISSUE_DRY_RUN=false`).
- **~~Every 30 min — Netcraft takedown poll~~ (RETIRED)** — the submission-level rollup poll (`shopfront-clone-poll-netcraft`) is **dark** (cron removed; it stamped rollup `malicious` onto all 50 URLs in a batch when 1 was malicious). Its role is replaced by the per-URL reconciler above; do NOT re-enable it. `submitted_to.netcraft.{state,takedown_at}` is now written by the reconciler.

### Outreach env vars

| Var                                | Purpose                                                                                                                                                                                                                                                                                                                                                     | Where set                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `NETCRAFT_REPORT_API_KEY`          | Auth header for Netcraft v3 Report API. Apply via `report@netcraft.com`. Submit + poll fns skip-with-reason when unset.                                                                                                                                                                                                                                     | Vercel → Production (pending application) |
| `NETCRAFT_REPORTER_EMAIL`          | Identity included in submissions. Defaults to `brendan@askarthur.au`.                                                                                                                                                                                                                                                                                       | Vercel → Production (optional)            |
| `URLSCAN_API_KEY`                  | urlscan.io free-tier API key. Powers the auto-scan + re-scan crons.                                                                                                                                                                                                                                                                                         | Vercel → Production (set 87d ago)         |
| `RESEND_FROM_EMAIL`                | Sender for Layers 3+4 brand-notification emails. **Required** — both the prepare cron's auto-send path and the dashboard send route fail closed (`resend_from_email_unset`) when missing. Read via `readStringEnv` to defeat trailing-whitespace + DefinePlugin static-inlining (PR-A 2026-05-28). Recommended shape `"Ask Arthur <brendan@askarthur.au>"`. | Vercel → Production                       |
| `SHOPFRONT_CLONE_OUTREACH_CAP_USD` | Aggregate cost-brake across all sub-features (submit / notify / digest / poll / urlscan + rescan). Defaults to `5`.                                                                                                                                                                                                                                         | Vercel → Production (optional)            |

### Netcraft false-negative reporter + lifecycle reconciler (v215–v219)

The per-URL flow (PRs #701/#702/#703, all default-OFF) that reads
`GET /submission/{uuid}/urls` (keyless — no API key), drives the lifecycle, and
files false-negative `report_issue` escalations. Plans:
`docs/plans/clone-watch-netcraft-false-negative-escalation.md` +
`docs/plans/clone-watch-netcraft-issue-pr2-fixes.md` +
`docs/plans/clone-watch-brand-story-reporting.md`.

| Flag / env / brake                    | Type        | Default                          | Purpose                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_CLONE_LIFECYCLE_RECONCILE`        | server flag | `false`                          | Gates `shopfront-clone-netcraft-reconcile` (cron `0 10 * * *`). Advances lifecycle from the per-URL verdict + feeds the takedown KPI + the weaponisation recheck. Sub-flag of `FF_SHOPFRONT_CLONE_OUTREACH`.                                                                                          |
| `FF_CLONE_NETCRAFT_ISSUE`             | server flag | `false`                          | Gates `shopfront-clone-netcraft-issue` (cron `0 11 * * *`) — the false-negative `report_issue` reporter. Sub-flag of `FF_SHOPFRONT_CLONE_OUTREACH`.                                                                                                                                                   |
| `NETCRAFT_ISSUE_DRY_RUN`              | server env  | dry-run unless literal `"false"` | Read as `readStringEnv(...) !== "false"` (an unset/whitespace value stays dry-run — a `readBoolEnv` default would deploy LIVE). Dry-run = ZERO posts + ZERO DB writes.                                                                                                                                |
| `NETCRAFT_ISSUE_DAILY_CAP`            | server env  | `20`                             | Max submission-uuids the reporter files per day (reporter-standing bound). Guarded `parseInt`; `$20`→NaN→default.                                                                                                                                                                                     |
| `feature_brakes.clone_netcraft_issue` | brake row   | absent (open)                    | Manual kill-switch AND auto-tripped by the reporter's autobrake on a permanent-4xx reject spike (≥3 or >50% of a run) → UPSERT `paused_until = now()+24h` + Telegram page. **Not** cost-cap auto-tripped (it's a $0 keyless feature). Clear by deleting the row / setting `paused_until` in the past. |

**Go-live sequence** (all dark today):

1. Verify `FF_AXIOM_ENABLED=true` (observability of rejects/filings).
2. `FF_CLONE_LIFECYCLE_RECONCILE=true` → one run populates lifecycle + KPI for the
   ~892-clone backlog. The first run stamps NO `takedown_at` (witnessed-transition
   rule, v219), so the median-time-to-takedown KPI is not inflated by backfill.
   Verify `taken_down`/`declined` counts go non-zero.
3. `FF_SHOPFRONT_CLONE_RECHECK` + `FF_SHOPFRONT_CLONE_URLSCAN` (+ `URLSCAN_API_KEY`)
   → the `declined → weaponised` loop that proves "no threat ≠ safe".
4. Validate one real POST: `NETCRAFT_ISSUE_PROBE_CONFIRM=yes node apps/web/scripts/netcraft-issue-probe.mjs <fresh-uuid>` (settles the body contract; already run 2026-07-10 → 200).
5. `NETCRAFT_ISSUE_DRY_RUN=false` → real escalations (single uuid first; cap 20/day; `no threats` only — `unavailable` deferred to a screenshot-backed follow-up).
6. `FF_BRAND_STEWARDSHIP_REPORT=true` → the monthly email renders the "What Netcraft did with them" story.

### `brand_contact_directory` curation

The notify-brand router (Inngest fn) + the triage-route inline-enqueue path both route by `channel_type`:

- `fraud_inbox` → Resend email to curated fraud/abuse address (e.g. `phishing@nab.com.au`, `hoaxes@cba.com.au`). The big-four banks all live here after v155 — Bugcrowd VDP scopes explicitly reject phishing/clone reports.
- `security_txt` → Resend email to RFC 9116 `Contact:` address. Used for AusPost only after v155.
- `bugcrowd_vdp` → Telegram-pages admin to open the VDP form. **0 brands currently** (v155 + v156 moved everything off this channel — VDPs are out-of-scope for clone reports).
- `contact_form` → Telegram-pages admin to fill the web form manually.
- `manual_review` → Telegram-pages admin to look up + add the contact to the directory.
- `none` → skip silently. Used for brands with no acceptable inbox (e.g. Telstra, Optus, Service NSW per v156 — re-route on case-by-case via the dedicated [issue #480 / #481 follow-ups](https://github.com/matchmoments-admin/ask-arthur/issues/480) when an inbox is confirmed).

**Current distribution (2026-05-28):**

| channel_type    | count | example brands                             |
| --------------- | ----- | ------------------------------------------ |
| `manual_review` | 42    | Bunnings, ALDI, etc. (verify-as-you-go)    |
| `fraud_inbox`   | 41    | NAB, Westpac, ANZ, CBA, ubank, ...         |
| `none`          | 13    | Telstra, Optus, Service NSW (PR #486 v156) |
| `contact_form`  | 9     | brands with no email, web form only        |
| `security_txt`  | 1     | AusPost                                    |
| `bugcrowd_vdp`  | 0     | (none — see v155 + v156 rationale)         |

To verify a `manual_review` row:

```sql
UPDATE public.brand_contact_directory
SET channel_type = 'fraud_inbox',
    recipient = 'abuse@bunnings.com.au',
    evidence_format = 'plain_email',
    notes = 'Verified via Bunnings security.txt — 2026-05-28',
    updated_at = now()
WHERE brand = 'Bunnings';
```

`FF_SHOPFRONT_CLONE_NOTIFY_BRAND` is **already ON in prod** (since 2026-05-27, first live NAB send at 09:24 UTC) — verifying a `manual_review` row to `fraud_inbox` immediately makes that brand reachable.

### urlscan rate-limit & budget

- Free tier: 100 scans/day.
- Expected use: ~5-10 new + ~50 daily re-scans + occasional admin "Scan now" = ~60-70/day.
- Admin "Scan now" soft rate-limit: 20/hour (cost_telemetry counted).
- If urlscan returns 429, the fn skips silently (no Telegram page). Rate-limit alerting tracked in [issue #426](https://github.com/matchmoments-admin/ask-arthur/issues/426).

### urlscan classification → triage mapping

| Classification    | Auto-triage             | Operator visibility                                                                                |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `parked_for_sale` | → `needs_investigation` | Falls off pending queue; visible in per-brand history table                                        |
| `unresolved`      | → `needs_investigation` | Falls off pending queue; re-scanned daily until 60-day cap                                         |
| `likely_phishing` | **NO auto-triage**      | Stays on pending queue with rose-red chip; operator confirms TP manually to emit downstream events |
| `neutral`         | —                       | Stays on pending queue with sky-blue chip for human review                                         |

### STOP suppression

When a brand replies "STOP" to a notification email, the inbound handler (Phase C — tracked in [issue #430](https://github.com/matchmoments-admin/ask-arthur/issues/430)) calls `ingest_clone_alert_brand_reply` with `classified_as='stop'`. The notify-brand fn checks `clone_alert_recipient_is_suppressed` before every send. To manually suppress a recipient without an inbound reply:

```sql
INSERT INTO public.clone_alert_brand_replies
  (from_email, classified_as, raw_message_id, body_excerpt, subject)
VALUES
  ('abuse@somebrand.com', 'stop', 'manual-' || gen_random_uuid(), 'manual suppression', 'Manual STOP');
```

### Weekly digest

Sun 10:00 UTC — `shopfront-clone-weekly-digest` Telegram-pages admin with KPI summary + LinkedIn-post draft (anonymised; never names a specific operator domain). Operator copy-pastes the draft to LinkedIn manually for v1.

---

## 9. Related

- [docs/plans/clone-watch-mvp.md](../plans/clone-watch-mvp.md) — the MVP build plan + matcher evolution log
- [docs/plans/clone-watch-outreach.md](../plans/clone-watch-outreach.md) — Layers 1–5 + Phase A.3 + measurement closure plan (§15 for follow-up scope)
- [docs/adr/0015-clone-detection-signal-model.md](../adr/0015-clone-detection-signal-model.md) — signal taxonomy + post-#408 substring-gating amendment
- [docs/adr/0016-clone-detection-source-layering.md](../adr/0016-clone-detection-source-layering.md) — Layer 0 source-layering decision + pull-forward amendment
- [docs/adr/0017-clone-detection-substring-gating.md](../adr/0017-clone-detection-substring-gating.md) — v2 matcher rationale: token list, ccTLD drop, why substring gated but not confusable/Levenshtein
- `packages/shopfront-glue/src/lexical-match.ts` — the matcher (`SCAM_CONTEXT_TOKENS` set, `hasScamContext` helper, `MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING=5`)
- `packages/shopfront-glue/src/au-brand-watchlist.ts` — the ~50-entry static watchlist; opt-out happens by editing this file
- `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts` — the Inngest function (cron `30 8 * * *` + `shopfront/nrd.manual-trigger.v1` event handler)
- `apps/web/app/clone-watch/page.tsx` — the public surface (now includes Phase A.3 aggregate impact block when `FF_SHOPFRONT_CLONE_OUTREACH=true`)
- `apps/web/app/admin/clone-watch/page.tsx` — the operator dashboard
- `apps/web/app/api/inngest/functions/clone-watch-*.ts` — 7 Inngest functions: `submit-netcraft`, `notify-brand`, `notify-brand-prepare` (daily 09:30 UTC batch builder), `poll-netcraft`, `weekly-digest`, `urlscan`, `urlscan-rescan`
- `apps/web/app/api/admin/clone-watch/batches/[batchId]/send/route.ts` + `.../reject/route.ts` — admin-approval endpoints powering `/admin/clone-watch#approvals`
- `apps/web/app/api/admin/clone-watch/scamwatch-export/route.ts` — CSV export for Scamwatch manual upload (PR #484; auto-submit tracked in [#485](https://github.com/matchmoments-admin/ask-arthur/issues/485))
- Open issues: [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409) v3 matcher word-boundary fix · [#426](https://github.com/matchmoments-admin/ask-arthur/issues/426) Netcraft observability · [#427](https://github.com/matchmoments-admin/ask-arthur/issues/427) TOAST sibling-table · [#428](https://github.com/matchmoments-admin/ask-arthur/issues/428) handler tests · [#429](https://github.com/matchmoments-admin/ask-arthur/issues/429) stale-queue dashboard · [#430](https://github.com/matchmoments-admin/ask-arthur/issues/430) Phase C inbound handler · [#434](https://github.com/matchmoments-admin/ask-arthur/issues/434) urlscan evidence audit trail
- BACKLOG.md #25 (flip `/clone-watch` to indexable after #371 v1 copy) + #26 (re-evaluate cross-surface dedupe with `brand_impersonation_alerts`)
