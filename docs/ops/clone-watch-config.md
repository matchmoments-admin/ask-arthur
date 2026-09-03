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

## Submission precision (v284, measured 2026-08-23)

**The lane was not broken. It was running at full volume and being rejected.**

|                                   |                                                                          |
| --------------------------------- | ------------------------------------------------------------------------ |
| Submissions to Netcraft, lifetime | 2,151                                                                    |
| Declined                          | **1,923 (89.4%)**                                                        |
| Credited by Netcraft, lifetime    | ~10                                                                      |
| August 2026 declines              | 1,850 (vs 73 in July — a backlog drain at the 50/day cap, now exhausted) |

### Why: the gate carried no information

`list_clone_alerts_pending_netcraft_auto` admitted anything the Haiku
preclassifier scored `is_clone AND confidence >= 0.7` — a judgement about how
the domain is _spelled_ — and checked nothing else. Decline rate by confidence:

| Confidence | Submitted | Declined |
| ---------- | --------- | -------- |
| 1.0        | 220       | 84.5%    |
| 0.9        | 1,394     | 90.4%    |
| 0.8        | 440       | 91.1%    |
| 0.7        | 84        | 90.5%    |

A flat curve — the most-confident candidates were rejected 5 times in 6. The
signal already stored on the same row predicts ~10x better:

| urlscan verdict   | Submitted | Survives  |
| ----------------- | --------- | --------- |
| `likely_phishing` | 135       | **53.3%** |
| never scanned     | 407       | 18.2%     |
| `neutral`         | 1,602     | 5.1%      |
| `parked_for_sale` | 7         | 0.0%      |

### Why it couldn't have used it: cron ordering

urlscan-submit `0 9`, urlscan-retrieve `0 */3` (first verdict 12:00),
netcraft-auto **`30 9`**. The lane reported 2.5h before the evidence could
exist — hence 407 alerts submitted with no scan at all. v284 moves it to 13:00.

### What changed

- **v284 RPC** — requires `urlscan_classification='likely_phishing' OR
lifecycle_state='weaponised'`, the same predicate the issue reporter has
  enforced since v221. Signature unchanged (a defaulted extra arg would create
  an overload); the gate is hard-coded because a knob is how this returns.
- **Cron 09:30 → 13:00**, after retrieve. _If retrieve moves, move this too_ —
  otherwise the gate starves instead of filtering.
- **Reconcile 10:00 + 22:00.** 44 live uuids against 12/day meant each was
  revisited every ~3.7 days, not the 24h `CADENCE_HOURS` advertises, so
  `takedown_at` and the TTD KPI ran that stale. A second run doubles throughput;
  `UUID_LIMIT` stays 12 because 60 hit the finish budget on 2026-07-10.

### Expected steady state

~200 new alerts/week, ~10 of them `likely_phishing` ⇒ **~1–2 submissions/day**,
not ~25. Absolute volume drops ~90%; expected _credited_ reports rise. A run
returning `no_candidates_or_cap_reached` is now normal on a quiet day and is
**not** by itself evidence of a starved lane — confirm against the RPC:

```sql
SELECT count(*) FROM shopfront_clone_alerts sca
WHERE NOT (sca.submitted_to ? 'netcraft')
  AND (sca.urlscan_classification='likely_phishing' OR sca.lifecycle_state='weaponised');
```

### Escalation is gated by BATCH SIZE, not just the evidence gate (v289, 2026-08-24)

Netcraft permits **one issue report per submission uuid**, and the auto lane
stamps every alert in a batch with the same uuid. So a batch of N alerts yields
N−1 alerts that can never be escalated — they drain in the issue lane as
`skipped: "submission_has_issue"`.

Measured batch sizes either side of v284:

| Submitted         | URLs per uuid |
| ----------------- | ------------- |
| 08-18 … 08-22     | 25 – 37       |
| 08-23 (post-v284) | **1**         |

The pre-v284 fat batches stranded **25 live weaponised clones**. Worse, they
were also too young for the v250 resubmit lane (`RESUBMIT_MIN_AGE_DAYS` 30), so
21 of them had no route out at all for up to 24 more days — the "escalation
dead zone". **v289** fixes that: an alert stamped `submission_has_issue`
bypasses the min-age wait, because no amount of waiting makes its current uuid
escalatable.

**The protection against a recurrence is the v284 evidence gate, not
`DAILY_CAP`.** The cap (50) is a ceiling that was never the binding constraint;
what shrank the batches is that far fewer candidates qualify. Loosen that
predicate and the batches re-fatten and this bug returns silently. Watch it:

```sql
-- URLs per submission uuid, recent. Should be ~1-2. A jump back to 25+ means
-- the evidence gate has been loosened and escalation is being strangled again.
SELECT date_trunc('day', (submitted_to->'netcraft'->>'submitted_at')::timestamptz)::date AS day,
       count(DISTINCT submitted_to->'netcraft'->>'uuid') AS uuids,
       count(*) AS urls,
       round(count(*)::numeric / NULLIF(count(DISTINCT submitted_to->'netcraft'->>'uuid'),0), 1) AS urls_per_uuid
FROM shopfront_clone_alerts
WHERE (submitted_to->'netcraft'->>'submitted_at')::timestamptz > now() - interval '14 days'
GROUP BY 1 ORDER BY 1 DESC;

-- Currently stranded by uuid collision. Should trend to zero as v289 drains it.
SELECT count(*) FROM shopfront_clone_alerts
WHERE lifecycle_state='weaponised'
  AND submitted_to->'netcraft_issue'->>'skipped'='submission_has_issue';
```

### Watch after activation

- Decline rate on submissions made after 2026-08-23 should fall well below 89%.
- A side effect worth knowing: the gate opens a path that did not exist —
  an alert that weaponises **without ever being submitted**. The v250 resubmit
  lane only covers alerts already carrying a uuid (min age 30 days), so these
  previously had no route to Netcraft at all.
- ~28% of new alerts still never get a urlscan verdict. That coverage gap is
  now the binding constraint on submission volume, and is the next thing to fix.

---

## 1. Feature flag

| Flag (env var)             | Type   | Default | Status | Gates                                                                                                                                                                                                                                                                            | Flip when                                                                                           |
| -------------------------- | ------ | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH` | server | `false` | ✅     | Master switch on the `shopfront-nrd-daily-ingest` Inngest function. When `false`, the function short-circuits before downloading the NRD zip and emits no telemetry. When `true`, the daily 08:30 UTC run downloads, parses, matches, and inserts into `shopfront_clone_alerts`. | After PR #398 ship + post-merge smoke. Currently ON in prod since 2026-05-24 (flag flip + 1st run). |

### Watchlist-overlay + candidate-source flags (activated 2026-07-28)

| Flag (env var)               | Type   | Status | Gates                                                                                                                                                                                                          |
| ---------------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_BRAND_DYNAMIC_WATCHLIST` | server | ✅ ON  | Merges the `monitored_brands` overlay into the watchlist via the single `getActiveWatchlist()` seam (v256, #866). Fails safe: flag off / no client / RPC error / zero rows all return exactly the static list. |
| `FF_SCAM_BRANDS_SOURCE`      | server | ✅ ON  | Adds `scam_reports.impersonated_brand` as a second candidate source to the weekly `reddit-brands-discover` run, aggregated at **≥ 2** (Reddit stays ≥ 3).                                                      |
| `FF_BRAND_AUTO_PROMOTE`      | server | ❌ OFF | Unattended promotion onto the live matcher. **Deliberately left off** — see "when to flip" below.                                                                                                              |

**Why these two were flipped together while both were no-ops.**
`monitored_brands` had 0 rows and the 30-day `scam_reports` window held
4 rows (Australia Post ×2, ANZ ×1, ATO ×1 — Australia Post already
watched), so neither flag changed behaviour on the day it was flipped.
That was the point: an empty overlay is the safest possible moment to
exercise the plumbing. `FF_BRAND_DYNAMIC_WATCHLIST` shipped dark in v207
and sat off for months, and in that time accumulated two latent bugs (an
empty-`legitimate_domains` merge that would have reported a brand's own
site as a clone of itself, and the static-vs-overlay read divergence that
would have re-announced every promoted brand weekly, forever). Neither
was caught by a test, because nothing exercised the path. Dark flags rot.

**Prerequisites that shipped first (#868)** — do not flip these back on a
revert without re-reading it:

- Per-source thresholds. While both sources shared `MENTION_THRESHOLD = 3`,
  `meetsPromotionBar()`'s `scam >= 2` branch was unreachable dead code.
- The overlay read is cached (60s TTL, single-flight, errors NOT cached,
  invalidated by promote/demote). Without it, turning
  `FF_BRAND_DYNAMIC_WATCHLIST` on adds a DB round trip to every
  `analyze-checkout` request — a route whose header states it is
  "LOW-LATENCY by design".
  **The cache is IN-PROCESS, so invalidation is per-instance.** A promotion is
  live on the instance that handled the click, and everywhere else within 60s.
  If an operator promotes a brand and a clone alert for it doesn't appear on the
  very next sweep, check the sweep started <60s after the promotion before
  treating it as a bug.

**When to flip `FF_BRAND_AUTO_PROMOTE` ON.** Not on a date — on evidence.
Two conditions, both required:

1. A Monday digest has proposed a brand you would have promoted yourself,
   twice. Until that happens, automation has nothing to automate.
2. One promotion has been done by hand through `/admin/brand-candidates`,
   which exercises the same `promote_watchlist_candidate` RPC with real
   data while a human is watching.

It fires only for candidates clearing the evidence bar (`scam >= 2` or
AU-hinted Reddit `>= 2`) **and** having a domain in `known_brands`. It
never guesses a domain — `legitimate_domains` is the matcher's exclusion
list, so a squatter-held `<brand>.com.au` recorded as legitimate is
exactly the domain that would stop being reported.

**TRAP — `vercel env add` defaults to SENSITIVE, and a sensitive flag is
falsy at runtime.** This bit the 2026-07-28 activation and cost a wasted
deploy. `vercel env add FF_X production` creates the variable as
_sensitive_ (write-only). `vercel env pull --environment=production` then
shows:

```
FF_BRAND_DYNAMIC_WATCHLIST=""     <- sensitive: unusable
FF_SHOPFRONT_CLONE_WATCH="true"   <- non-sensitive: works
```

`vercel env ls` labels BOTH "Encrypted", so the listing cannot tell you
which kind you created — the only reliable check is `env pull` and
comparing against a flag you know works. Always create feature flags with:

```bash
printf 'true' | vercel env add FF_X production --no-sensitive --force
```

**How to prove a flag is actually live, rather than assuming.** Hitting a
route that exercises the path is NOT sufficient: `getActiveWatchlist()`
fails safe, so a falsy flag and a healthy overlay produce the same 200
response. Check whether the database call actually happened:

```sql
select calls, left(query, 90) as q
from extensions.pg_stat_statements
where query ilike '%list_active_monitored_brands%'
order by calls desc limit 5;
```

A PostgREST-originated call appears as a `WITH pgrst_source AS (...)`
wrapper. If the only rows are your own psql/MCP queries, the app never
called it and the flag is off — which is exactly how the sensitive-var
problem was caught. The same technique generalises to any flag whose only
observable effect is a query.

**Reverting.** `vercel env rm FF_BRAND_DYNAMIC_WATCHLIST production` (or
set `false`) + a deploy carrying `[build]`. The matcher falls back to the
static ~212-brand list; no data migration needed. Any already-promoted
brands stay in `monitored_brands` but become invisible to the matcher —
use `demote_watchlist_candidate()` or the admin Undo button if you want
them back in the review queue as well.

---

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
- **10:00 + 22:00 UTC** — `shopfront-clone-netcraft-reconcile` (v217, gated `FF_CLONE_LIFECYCLE_RECONCILE`; second daily run added v284 — see § Submission precision) reads the PER-URL truth from `GET /submission/{uuid}/urls` and advances each submitted clone's `lifecycle_state` by its own `url_state` (`malicious→taken_down` + witnessed `takedown_at`; `no threats`/`unavailable→declined`). This is the single Netcraft verdict source.
- **12:00 UTC** — `shopfront-clone-urlscan-retrieve` (`0 */3`) lands the day's urlscan verdicts. This is the evidence the next step reads, which is why it must precede it.
- **13:00 UTC** — `shopfront-clone-netcraft-auto` (gated `FF_SHOPFRONT_CLONE_NETCRAFT_AUTO`) bulk-submits to Netcraft. **v284: requires urlscan `likely_phishing` OR `lifecycle_state='weaponised'`** — lexical classifier confidence alone is not evidence (see § Submission precision). Ran at 09:30 until 2026-08-23, i.e. 2.5h _before_ the verdict above existed. Expect ~1–2 URLs/day, not ~25; `DAILY_CAP` 50 is a ceiling, not a target.
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

> **`submitted_to->netcraft->>'state'` is a FOSSIL — do not read it as a live
> signal (2026-09-02, #1063).** It was written only by the rollup poll
> (`shopfront-clone-poll-netcraft`, structurally dead, DELETED in #1069) and is
> `null` on every submission since ~2026-07-20. The live outcome signals are
> `lifecycle_state` plus the `netcraft_declined_at` / `takedown_at` /
> `re_takedown_at` stamps, all written by `apply_netcraft_reconcile`. Note the
> reconcile's no-downgrade rule also means a **weaponised** row is never marked
> `declined` — post-v284 "decline rate" is structurally unmeasurable for the
> weaponised cohort; the success signal to watch is takedown conversions.

The per-URL flow (PRs #701/#702/#703, all default-OFF) that reads
`GET /submission/{uuid}/urls` (keyless — no API key), drives the lifecycle, and
files false-negative `report_issue` escalations. Plans:
`docs/plans/clone-watch-netcraft-false-negative-escalation.md` +
`docs/plans/clone-watch-netcraft-issue-pr2-fixes.md` +
`docs/plans/clone-watch-brand-story-reporting.md`.

> **Re-report path clarification (2026-07-16).** The v199 migration comments
> describe declined alerts being "re-submitted as a FRESH submission" on a
> weaponisation transition — that path was never wired (the only
> `report/urls` trigger is the manual triage route, and its dedup gate skips
> any alert already carrying `submitted_to.netcraft`). The actual — and
> deliberate — weaponised re-report mechanism is this `report_issue` reporter:
> the v221 evidence gate re-admits a declined clone to the worklist the moment
> it weaponises. Do not build a fresh-submission duplicate.

| Flag / env / brake                    | Type        | Default                          | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FF_CLONE_LIFECYCLE_RECONCILE`        | server flag | `false`                          | Gates `shopfront-clone-netcraft-reconcile` (cron `0 10 * * *`). Advances lifecycle from the per-URL verdict + feeds the takedown KPI + the weaponisation recheck. Sub-flag of `FF_SHOPFRONT_CLONE_OUTREACH`.                                                                                                                                                                                                                                                             |
| `FF_CLONE_NETCRAFT_ISSUE`             | server flag | `false`                          | Gates `shopfront-clone-netcraft-issue` (cron `0 11 * * *`) — the false-negative `report_issue` reporter. Sub-flag of `FF_SHOPFRONT_CLONE_OUTREACH`. **F4 evidence-gated since v221**: the worklist only returns `urlscan_classification='likely_phishing'` OR `lifecycle_state='weaponised'` (784→32 pending alerts at apply time); gated-out clones stay pending-by-predicate (no stamp) and re-enter when they weaponise; issue `reason` cites the urlscan result URL. |
| `NETCRAFT_ISSUE_DRY_RUN`              | server env  | dry-run unless literal `"false"` | Read as `readStringEnv(...) !== "false"` (an unset/whitespace value stays dry-run — a `readBoolEnv` default would deploy LIVE). Dry-run = ZERO posts + ZERO DB writes.                                                                                                                                                                                                                                                                                                   |
| `NETCRAFT_ISSUE_DAILY_CAP`            | server env  | `20`                             | Max submission-uuids the reporter files per day (reporter-standing bound). Guarded `parseInt`; `$20`→NaN→default.                                                                                                                                                                                                                                                                                                                                                        |
| `feature_brakes.clone_netcraft_issue` | brake row   | absent (open)                    | Manual kill-switch AND auto-tripped by the reporter's autobrake on a permanent-4xx reject spike (≥3 or >50% of a run) → UPSERT `paused_until = now()+24h` + Telegram page. **Not** cost-cap auto-tripped (it's a $0 keyless feature). Clear by deleting the row / setting `paused_until` in the past.                                                                                                                                                                    |
| `FF_CLONE_WEAPONISED_ALERT`           | server flag | `false`                          | F1 — gates `shopfront-clone-notify-weaponised` (event `shopfront/clone.weaponised.v1`, v220). Stages an URGENT single-alert `kind='weaponised'` batch for the four-eyes dashboard send the moment a monitored lookalike flips to `likely_phishing`. Bypasses the 24h brand cooldown at staging (the send still stamps it); ALWAYS four-eyes even when `…NOTIFY_BRAND_AUTO_SEND` is ON. Sub-flag of `FF_SHOPFRONT_CLONE_OUTREACH`.                                        |

**Go-live sequence** (all dark today):

1. Verify `FF_AXIOM_ENABLED=true` (observability of rejects/filings).
2. `FF_CLONE_LIFECYCLE_RECONCILE=true` → one run populates lifecycle + KPI for the
   ~892-clone backlog. The first run stamps NO `takedown_at` (witnessed-transition
   rule, v219), so the median-time-to-takedown KPI is not inflated by backfill.
   Verify `taken_down`/`declined` counts go non-zero.
3. `FF_SHOPFRONT_CLONE_RECHECK` + `FF_SHOPFRONT_CLONE_URLSCAN` (+ `URLSCAN_API_KEY`)
   → the `declined → weaponised` loop that proves "no threat ≠ safe".
4. Validate one real POST: `NETCRAFT_ISSUE_PROBE_CONFIRM=yes node apps/web/scripts/netcraft-issue-probe.mjs <fresh-uuid>` (settles the body contract; already run 2026-07-10 → 200).
5. Review the dry-run payloads the v221 evidence gate now yields (the 32
   weaponised, all urlscan `likely_phishing` — check
   `Axiom fnId=shopfront-clone-netcraft-issue` after a run), then
   `NETCRAFT_ISSUE_DRY_RUN=false` → real escalations (single uuid first via
   `NETCRAFT_ISSUE_DAILY_CAP=1`; then cap 20/day; `no threats` only —
   `unavailable` deferred to a screenshot-backed follow-up; note the payload
   has NO screenshot field — evidence travels as the urlscan link in `reason`).
6. `FF_BRAND_STEWARDSHIP_REPORT=true` → the monthly email renders the "What Netcraft did with them" story.

### Weaponisation early-warning alert (F1, v220)

`shopfront-clone-notify-weaponised` is the BRAND-facing consumer of
`shopfront/clone.weaponised.v1` (the enforcement-plan consumer opens internal
cases only). Flow: reload the alert row → resolve the contact via
`brand_contact_directory` (`inferred_target_domain` → `legitimate_domain`,
same seam as notify-brand) → STOP-suppression check →
`enqueue_weaponised_clone_alert_notification` (ONE `kind='weaponised'`,
`severity='critical'` queue row per alert, ever — v220 partial unique index;
a clone already brand-notified at triage can still stage an urgent alert
weeks later) → render `WeaponisedCloneAlert` + `assign_clone_alert_batch`
(hard-coded four-eyes) → 🚨 Telegram page → admin sends from
`/admin/clone-watch#approvals` via the unchanged send route. No-contact /
manual-channel outcomes still 🚨-page the admin (a weaponisation must never
pass silently). Dedup: Inngest `idempotency: alertId` (24h) +
`submitted_to.weaponised_notification` stamp (forever) + the partial index
(DB backstop). Honesty: template states "our scanner classified X as likely
phishing" only; the vendor-decline line renders only when
`netcraft_declined_at` is set; render tests assert no takedown/"confirmed"
claims. Telemetry: `cost_telemetry` `operation='weaponised_enqueue'` +
always-ship `logger.warn` on stage.

### Weaponisation-risk score (F3, v222)

`apps/web/lib/clone-watch/weaponisation-risk.ts` is **the one formula** —
deterministic 0–100 (urlscan prior + Haiku confidence + attack intent +
lexical signal + brand category + domain age + IP reputation), banded
low/elevated(≥40)/critical(≥70). The v222 recheck RPC returns score INPUTS
only (never a SQL copy — the outcome-copy drift rule). Consumers: the recheck
loop (over-fetch 200 → rank → rescan top 50; distribution in
`cost_telemetry WHERE feature='shopfront_clone_recheck'` metadata — the
weight-tuning feedstock) and the Brand Stewardship email ("highest-risk
unactioned" block; per-row `risk_score` snapshots into the report ledger).
v1 weights are hand-set priors — revisit once weaponisation outcomes
accumulate.

### Reporter liveness pre-check (F3, three-valued since v248)

Before filing, the issue reporter GETs each candidate URL
(`lib/clone-watch/liveness.ts`, shared with auto-triage). All-dead uuid →
non-terminal `netcraft_issue.recheck_after` (+72h; revived sites re-enter,
permanent deadness converges via the 30-day `submitted_at` window) — the
one-per-submission issue slot is never spent on a dead site. Partial-live →
files the live subset; dead candidates stamp `skipped: 'dead_at_probe'`
(they forfeit that uuid's slot — the POST already consumed it). Dry-run logs
`liveCount/deadCount/deadDomains`.

**Verdict semantics (v248).** The probe returns `true` / `false` / `null`, and
**only NXDOMAIN is `false`**. Callers apply their own policy: the issue reporter
files on `live !== false`; auto-triage keeps the conservative bar via
`isCandidateLive()` (`live === true`).

| observation                                        | verdict | reason              |
| -------------------------------------------------- | ------- | ------------------- |
| HTTP < 500                                         | `true`  | `http`              |
| HTTP ≥ 500                                         | `null`  | `http`              |
| TLS failure, `http://` fallback answers < 500      | `true`  | `tls_http_fallback` |
| TLS failure, fallback also fails                   | `null`  | `tls`               |
| Connection refused / reset (DNS resolved by proof) | `null`  | `refused`           |
| Timeout, name still resolves                       | `null`  | `timeout`           |
| **No A record and no NS record**                   | `false` | `nxdomain`          |

Why: the pre-v248 probe collapsed every `fetch` rejection into "dead" and
starved the reporter — 13 of 19 batches in the 10 days to 2026-07-26 drained on
`dead_at_probe`, producing one filing. `targetshopp.cc` (weaponised, urlscan
`likely_phishing`) was drained as dead while serving, purely because its cert
has a hostname mismatch. From Vercel's egress a refused connect is
indistinguishable from a phishing kit blocking us, so DNS is the only honest
deadness test we control. The `reason` is recorded on every drain stamp —
diagnosing the original incident needed a live re-probe because the old boolean
threw it away.

### `unavailable` is a deferral, not a verdict (v248)

Netcraft grades on a single fetch at submission time, so a lookalike that was
parked, cloaked or not yet stood up reads `unavailable`. Prod:
`id-apple-kc.shop` was submitted 09:30, graded `unavailable` at 10:00, and was
serving phishing by 12:01 the same day.

- **Never terminal.** `defer_clone_alert_netcraft_issue` sets `recheck_after`
  and bumps `netcraft_issue.rounds.<reason>`, converting to a terminal
  `skipped: '<reason>_exhausted'` past 5 rounds. Before v248 it stamped
  `skipped: 'unavailable_deferred'`, which the v221 worklist predicate excludes
  forever — 19 weaponised alerts, more than had ever been filed, were locked
  out. The v248 migration released all 25 such rows.
- **Escalatable on weaponised evidence.** When our own scan witnessed
  weaponisation and Netcraft's says `unavailable`, that disagreement _is_ the
  false negative — so it becomes a filable candidate. `likely_phishing` alone
  still defers, keeping the blast radius tight.

### Weaponised re-submission lane (v250, dark)

23 of 54 weaponised clones have no Netcraft submission the issue reporter can
escalate against — 3 never submitted, 20 aged past the reporter's 30-day window
(`report_issue` 404s once Netcraft archives a submission). A second lane inside
`shopfront-clone-netcraft-auto` files a **fresh** report for them, carrying the
urlscan evidence.

| Key                                      | Kind        | Default | Notes                                                                                                                                                                                        |
| ---------------------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_CLONE_NETCRAFT_RESUBMIT`             | server flag | `false` | Gates the lane. Independent of `FF_CLONE_NETCRAFT_ISSUE` so the outbound path can be killed on its own. Still requires `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT` + `FF_SHOPFRONT_CLONE_OUTREACH`. |
| `NETCRAFT_RESUBMIT_DAILY_CAP`            | server env  | `10`    | Bare number — `parseInt("$10")` is `NaN` and falls back to the default.                                                                                                                      |
| `feature_brakes.clone_netcraft_resubmit` | DB row      | absent  | Operator kill-switch, separate from `clone_netcraft_issue`.                                                                                                                                  |

Reporter standing is the risk this lane carries, so the bounds are layered:
weaponised-only, liveness-confirmed (`live !== false`), **no recorded
takedown**, a 14-day per-alert cooldown, a hard 3-resubmit ceiling per alert, a
per-UTC-day global budget (re-firing the manual trigger cannot exceed the day's
allowance), and the v176 FP-brand denylist.

**v253 — the budget is per UTC day, not a rolling 24h window.** It was rolling
until day 2 of the lane's life. The cron fires at a fixed 09:30 UTC and day 1's
rows were stamped `09:30:52`, so day 2's run at `09:30:00` saw them 52 seconds
_inside_ its own 24h window: `used = 10`, `budget_remaining = 0`, zero rows,
no-op. Day 3 would see 48h-old stamps and work. Net: 10 URLs every two days
against a documented cap of 10/day, with `reason: "none_pending_or_cap"` on the
idle days reading like an empty worklist rather than a starved one. **A
fixed-time cron can never clear a rolling window its own previous run just
wrote into.** The anti-flood property is unchanged — a manual re-fire later the
same day still counts the day's submissions and is still blocked.

**v252 — proved-dead rows are deferred, not dropped.** Liveness can only be
established in the caller, so v250/v251 rank-limited the worklist to the daily
cap and then filtered dead rows out of the batch in TypeScript — without
stamping them. A dead row therefore returned at the head of the ordering the
next day, and every day after. Measured 2026-07-26, hours before the first live
run: 9 of the 23 eligible alerts were NXDOMAIN, which projected to
6 → 3 → 2 → 1 submissions per day, converging on 9 of 10 daily slots spent on
domains that no longer exist — with the lane returning `ok: true` throughout.
The same failure class as the v224 recheck incident.

Two changes fix it, both in `list_clone_alerts_pending_netcraft_resubmit`
(v252) and its caller:

- **Deferral.** `defer_clone_alert_netcraft_resubmit` stamps
  `submitted_to.netcraft_resubmit` with `recheck_after` (+7 days) and
  `rounds.dead_at_probe`, going terminal (`skipped: "dead_at_probe_exhausted"`)
  after 5 rounds — ~35 days continuously NXDOMAIN. The worklist excludes both.
  Same shape as the issue reporter's v248 deferral, under its own key so the
  two cannot collide. A revived host re-enters automatically until it
  exhausts; after that, clearing it is an operator action:

  ```sql
  update shopfront_clone_alerts
  set submitted_to = submitted_to #- '{netcraft_resubmit,skipped}'
  where candidate_domain = '<domain>';
  ```

- **Over-fetch.** The worklist now returns up to `p_probe_limit` rows (the
  caller passes 3× the cap) and reports the 24h allowance as a
  `budget_remaining` column rather than bounding the row count with it. The
  caller probes everything returned and submits the first `budget_remaining`
  **live** rows. Without this, a batch containing dead rows can never fill the
  day's cap even once the deferral is draining them.

Per-run telemetry carries `dead`, `deferred`, `budget` and a `dead_reasons`
array (domain + probe verdict), so a deadness call is diagnosable later without
a live re-probe — by which time the answer has changed.

**v251 — a prior escalation does NOT disqualify a row.** v250 excluded alerts
carrying `netcraft_issue.issue_reported_at` to keep the `refileToTakedown`
median unambiguous. That was measurement deciding who gets reported, which is
backwards. The 6 rows it excluded (airwallex, revolut ×2, bonds ×2, whatsapp)
were all urlscan `likely_phishing`, all reported in July, **none actioned by
Netcraft**, and 5 of 6 still resolved — with their submission archived, a fresh
report was their only remaining path. The KPI is protected properly instead:
`duration-kpis.ts` drops **both** takedown-terminated legs (`refileToTakedown`,
`fullLoop`) for any row with `netcraft.resubmit_count > 0`, because on a
resubmitted row the takedown belongs to a different submission than the one the
issue was filed against. The exclusion is silent — it is deliberate, not a data
pathology, so it feeds neither `excludedNegativeN` nor `anomalousInversionsN`.

Still out of scope: weaponised clones whose submission is **inside** the 30-day
window. Those are visible to the reconciler and, if unfiled, to the issue
reporter; resubmitting a URL that sits in an active submission is the case most
likely to read as duplicate spam.

`record_clone_alert_netcraft_resubmit` keeps `submitted_to.netcraft` as the ONE
current submission — the superseded one is pushed onto `netcraft.prior[]` —
carries `reconciled_at` forward (v219's witnessed rule would otherwise read the
next pass as backfill and drop a real timed takedown), and clears a stale
_unfiled_ `netcraft_issue` stamp so the new uuid is escalatable if Netcraft
declines it too.

**Status: LIVE.** `FF_CLONE_NETCRAFT_RESUBMIT=true` in Production since
2026-07-26 (Vercel env + redeploy `ask-arthur-8sqt853x4`). First live run is the
09:30 UTC `shopfront-clone-netcraft-auto` cron; the lane was capped at the
default 10 URLs/day for it.

> **`{"test": true}` now exercises this lane too** (2026-07-26). It used to
> return `{skipped: true, reason: "test_mode"}` before reaching the flag check,
> so the validation-only endpoint covered the AUTO lane's payload and nothing
> else — and the resubmit payload is the novel one (a multi-line `reason`
> carrying up to 10 urlscan URLs, versus the auto lane's single short
> paragraph). Under test both lanes bypass their FF gates, the resubmit body is
> built from the REAL worklist, and an all-dead batch falls through to
> validation instead of short-circuiting. Nothing is persisted and no cost row
> is written.
>
> ```bash
> # dry run — validates the payload, creates no report, sends no email
> inngest event send shopfront/clone.netcraft-auto.producer.manual-trigger.v1 \
>   --data '{"test": true}'
> ```
>
> Read `resubmit.validated` / `resubmit.status` / `resubmit.response` off the
> run. A non-2xx here is the answer to the open question — Netcraft's limit on
> the `reason` field. In a real run a rejection soft-fails ($0 diagnostic under
> `shopfront-clone-netcraft-resubmit-error`, rows left unmarked, retried next
> run): nothing breaks, but the submission is wasted.
>
> Note this still does NOT confirm the flag reached the runtime — test mode
> bypasses the flag by design. `reason: "FF_CLONE_NETCRAFT_RESUBMIT disabled"`
> on a REAL run means redeploy, not re-add.

**What to watch after the first run**

```sql
-- lane outcome (candidates / live / dead / marked / brands / netcraft_uuid)
select created_at, metadata from cost_telemetry
where feature in ('shopfront_clone_netcraft_resubmit',
                  'shopfront-clone-netcraft-resubmit-error')
order by created_at desc limit 5;

-- rows that actually moved
select candidate_domain, inferred_target_domain,
       submitted_to->'netcraft'->>'uuid'           as new_uuid,
       submitted_to->'netcraft'->>'resubmit_count' as n,
       jsonb_array_length(submitted_to->'netcraft'->'prior') as prior_kept
from shopfront_clone_alerts
where (submitted_to->'netcraft'->>'resubmitted_at')::timestamptz
        > now() - interval '24 hours';
```

A run that logs `shopfront_clone_netcraft_resubmit` with `marked > 0` is a clean
pass. `reason: "FF_CLONE_NETCRAFT_RESUBMIT disabled"` in the fn return means the
env var did not reach the runtime — redeploy rather than re-adding the var.

**Kill switch:** `insert into feature_brakes (feature, paused_until, reason,
set_by) values ('clone_netcraft_resubmit', now() + interval '24 hours',
'<why>', '<who>') on conflict (feature) do update set …` — stops this lane
only, leaving the issue reporter and the auto lane untouched.

### Enabling `FF_SHOPFRONT_CLONE_RECHECK` (runbook)

The recheck loop (`shopfront-clone-lifecycle-recheck`, cron `30 */6 * * *`,
batch 50/run → ≤200 unlisted urlscan submits/day) is the declined→weaponised
detector — the enabler for F1 and the F4 evidence gate.

1. **Quota check** (pre-flip): pull the prod key and confirm **unlisted**
   headroom ≥200/day and ≥50/hour:
   `KEY=$(vercel env pull /dev/stdout --environment=production | grep '^URLSCAN_API_KEY=' | cut -d= -f2)` then
   `curl -s -H "API-Key: $KEY" https://urlscan.io/user/quotas/ | jq '.limits'`.
   (~776 declined/monitoring backlog drains over ~4 days, then steady-state.)
2. Preconditions: `FF_SHOPFRONT_CLONE_URLSCAN=true`;
   `feature_brakes.shopfront_clone_recheck` absent or expired.
3. `vercel env add FF_SHOPFRONT_CLONE_RECHECK production` → `true`; redeploy
   (env changes need a fresh deployment).
4. Verify first run (next 6h tick or fire
   `shopfront/clone.lifecycle-recheck.manual-trigger.v1`): Inngest run green;
   `SELECT count(*) FROM shopfront_clone_alerts WHERE last_rechecked_at > now() - interval '6 hours'` ≈ 50;
   `cost_telemetry` urlscan volume up at $0.
5. Watch for the first `weaponised.v1` → F1 🚨 Telegram page (if
   `FF_CLONE_WEAPONISED_ALERT` is ON) + an enforcement case.
6. **Rollback**: UPSERT `feature_brakes.shopfront_clone_recheck` with a future
   `paused_until` (instant, no deploy), or remove the env var + redeploy.

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

### urlscan coverage (v285, measured 2026-08-23)

**924 of 2,786 alerts had never received a urlscan verdict** — 422 of them rows
the preclassifier scored as a clone at confidence >= 0.7. This became critical
when v284 made Netcraft submission require a verdict: no verdict now means no
report, ever.

| Population                               | n   | high-confidence |
| ---------------------------------------- | --- | --------------- |
| retired at `urlscan_failure_streak >= 3` | 282 | **281**         |
| never attempted                          | 532 | 44              |
| in flight (streak 1-2)                   | 110 | 97              |

**269 of the 282 retired rows failed with `400 - "DNS Error - Could not resolve
domain"`.** A random sample of 70 of those domains was resolved on 2026-08-23:
**30 (43%) resolve today** — `deutschebnk.org`, `kraken-login.org`,
`noreply-supportfacebook.com`, `amazon-business-service.shop`, `amaz0n.plus`,
`hsbc.co.mw` among them. A newly-registered domain that does not resolve _yet_ is
the pre-weaponisation state this feature exists to watch; we were retiring it
after three attempts and never looking again.

Two causes, both fixed in v285:

- **NXDOMAIN was treated as death.** v279 added a 7-day retry cadence for
  `status=400` rows, but the `urlscan_failure_streak < 3` gate still killed them
  first. A 400 no longer counts toward the streak — the same carve-out the repo
  already makes for 429s (`urlscan-submit-one.ts:112`). No backfill was needed;
  the predicate change alone re-admitted them.
- **LIFO starvation + a 14-day cutoff.** `ORDER BY first_seen_at DESC` against a
  30-row cap meant fresh alerts won every slot; a passed-over row was never
  stamped (so never "failed"), just outranked until it aged out permanently —
  invisible to submit (aged out), retrieve (needs a uuid) and recheck (gates on
  `monitoring`/`declined`). Now the horizon is 90 days and **one third of every
  batch is reserved for the oldest eligible rows**, ordered first so the
  wall-clock break cannot re-create the starvation.

Measured effect on apply: the worklist went from returning **18 rows to 75**
(the full cap), with positions 1-25 being the 84-90-day rows nearest the horizon.

**`dormant` now has a writer.** It has been in the `lifecycle_state` CHECK
constraint since v199 with readers (UI badges, `NO_DOWNGRADE_STATES`) and the
comment "NXDOMAIN for N re-checks", but nothing ever wrote it. Widening the
horizon alone would have moved the silent drop from day 14 to day 90, so
`mark_stale_clone_alerts_dormant` (called from the submit fn before its
empty-worklist return) retires aged-out unscanned rows explicitly and returns a
count that lands in `cost_telemetry` metadata as `dormant_retired`.

**`dormant` is deliberately TERMINAL, and that is a judgement call worth
re-examining.** Nothing transitions a row out of it — not submit (the row is
past the 90-day horizon and `first_seen_at` only gets older), not retrieve (no
uuid), not recheck (gates on `monitoring`/`declined`). The sweep does not
_cause_ that loss: those rows were already invisible to every lane the moment
they crossed the horizon. What it changes is that the abandonment is now
recorded instead of silent. But given the 43% figure above, a domain that never
resolved in 90 days is not certainly dead, so if we ever want a cohort back:

```sql
-- Revive a dormant cohort (re-enters the submit worklist only if it is also
-- inside the 90-day horizon, so widen the horizon first or this is a no-op).
UPDATE public.shopfront_clone_alerts
SET lifecycle_state = 'detected', alert_state = 'open', updated_at = now()
WHERE lifecycle_state = 'dormant' AND candidate_domain = ANY($1);
```

**Two different things now share the `dormant` badge.** v199's original meaning
was "was observed live, then dropped off DNS" — evidence the threat receded.
v285's is "we never got a single urlscan result and gave up at 90 days" — no
evidence either way. `lifecycleBadge()` (`apps/web/lib/clone-watch/outcome-copy.ts`)
renders one grey DORMANT for both, so an operator cannot tell "safe to stop
worrying" from "we simply stopped looking". Distinguishing them needs a reason
field; until then, `urlscan_uuid IS NULL` separates the v285 cohort.

Confirm the lane is healthy rather than starved:

```sql
SELECT count(*) FROM list_clone_alerts_pending_urlscan_submit(75, 0.7, 3);
```

### urlscan rate-limit & budget

- **SETTLED 2026-08-23 — the quota check had never been run, and the documented
  figure was wrong by 10x.** Actual entitlement on the production key:

  | Scope                                 | Daily limit | In use that day |
  | ------------------------------------- | ----------- | --------------- |
  | `unlisted` (what the lanes submit as) | **1,000**   | 35              |
  | `public`                              | 5,000       | 0               |
  | `private`                             | 50          | 0               |
  | `retrieve`                            | 10,000      | 38              |

  Re-run it with (`URLSCAN_API_KEY` is Vercel-only — not in any local `.env`):
  `curl -s -H "API-Key: $URLSCAN_API_KEY" https://urlscan.io/user/quotas/ | jq '.limits'`

  The old "100/day free tier, UNVERIFIED" note had been used to justify keeping
  `SUBMIT_BATCH_LIMIT` at 30. It was never a vendor number. At v285's 75/day plus
  the recheck lane's ~200/day we sit at roughly a quarter of the real ceiling; the
  binding constraint is the submit fn's 200s wall clock, not urlscan.

- **There is no true per-day SUBMISSION budget on this lane, and the fn-level
  `throttle` is not one.** Throttle caps RUNS per period (see the
  [brake-matrix glossary](../inngest-brakes.md)); one run submits up to
  `SUBMIT_BATCH_LIMIT` rows, so the worst case is `throttle x batch`, not
  `throttle`. v285 briefly raised the throttle 40 -> 90 on that misreading — which
  would have widened the manual-trigger blast radius to 90x75 against a 1,000/day
  quota — and it was reverted the same day. The daily figure in practice is one
  cron fire = `SUBMIT_BATCH_LIMIT` (75); operator re-fires stack on top. If a real
  budget is ever wanted, the shape to copy is the `today` CTE in
  `list_clone_alerts_pending_netcraft_auto` (v284), which folds a 24h allowance
  into the worklist itself rather than relying on an invocation cap.

- **Measured use, 30 days to 2026-08-09: ~230 submit POSTs/day** —
  `recheck_submit` ~200/day (50 x 4 crons) + `submit_batch` 30/day. The previous
  estimate here ("~5-10 new + ~50 daily re-scans = ~60-70/day") predated the
  recheck loop going live and understated reality by 3-4x. Query it, don't
  estimate it:
  `select date_trunc('day',created_at)::date, operation, sum(units) from cost_telemetry where provider='urlscan' group by 1,2 order by 1 desc;`
- Admin "Scan now" soft rate-limit: 20/hour, counted from `cost_telemetry` rows
  under `feature='shopfront_clone_urlscan'`. **This was dead until 2026-08-10** —
  `clone-watch-urlscan-scan-one` wrote no `logCost` row, so the counter only ever
  saw the batch lanes' ~13 rows/day and no rolling hour could reach 20. It now
  logs one row per operator scan, and the route fails CLOSED (503) when the count
  is unreadable rather than treating a null head-count as zero.
- If urlscan returns 429 the submit path leaves the row untouched (quota is not
  evidence about the URL) and now counts it as `rate_limited` in the
  `submit_batch` cost_telemetry metadata. Before that it was folded into
  `submit_failed` and left no trace anywhere, which is why "has urlscan ever
  rate-limited us?" had no answer. Telegram alerting still tracked in
  [issue #426](https://github.com/matchmoments-admin/ask-arthur/issues/426).

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

## 8b. Brand Monitor billing (Wave 3 — Brand activation 2/4)

Self-serve Stripe checkout for the two paid Brand Monitor plans. Code shipped
dark: the route is live behind `FF_BRAND_EXPOSURE` (ON in prod) but returns
`price_not_configured` until the price-ID env vars below exist.

**Plans** (prices fixed by `BRAND_PLANS` in `packages/types/src/billing.ts`):

| Plan                 | A$/mo (GST-incl.) | Env var (Stripe price ID)                                                                     |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `brand_monitor`      | 1,950             | `NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY`                                                    |
| `brand_monitor_plus` | 2,950             | `NEXT_PUBLIC_STRIPE_BRAND_MONITOR_PLUS_MONTHLY`                                               |
| `brand_pilot`        | 300 (manual)      | — no Stripe product; provisioned manually (`billing_provider='manual'`, Brand activation 3/4) |
| `brand_enterprise`   | custom            | — contact sales, no self-serve SKU                                                            |

**Surfaces:**

- `POST /api/brand/checkout` — session-authed; body `{ orgId, plan }`; requires
  an active `org_members` row with `billing:manage` (owner/admin). Creates a
  Stripe subscription checkout session (`automatic_tax` on, AUD).
- Stripe webhook (`/api/stripe/webhook`) — dispatches the two price IDs into an
  org-keyed branch (`apps/web/lib/brandSkus.ts`): writes
  `organizations.settings.brand_billing` (plan, status, Stripe linkage) and
  syncs `monitored_brands.plan` (v207). Never touches `api_keys.tier` —
  brand plans are a separate SKU axis from `TIER_LIMITS`. Cancellation clears
  only rows carrying the cancelled plan, so a manual `brand_pilot` row
  survives a Stripe cancellation.

**Founder activation checklist (Stripe Dashboard, ~15 min):**

1. Products → Add product ×2: "Brand Monitor" (recurring monthly **A$1,950**)
   and "Brand Monitor+" (recurring monthly **A$2,950**). Currency **AUD**;
   price tax behaviour **inclusive** (GST-inclusive, matching Extension Pro);
   confirm Stripe Tax is active so `automatic_tax` resolves AU GST.
2. Copy the two `price_...` IDs → Vercel env vars
   `NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY` /
   `NEXT_PUBLIC_STRIPE_BRAND_MONITOR_PLUS_MONTHLY` (all three envs; they are
   `NEXT_PUBLIC_*`, so a **redeploy is required** for build-time inlining).
3. Test mode e2e: create the same products in test mode, paste test price IDs
   into a preview env, run a `4000 0003 6000 0006` (AU) card checkout, confirm
   the webhook writes `organizations.settings.brand_billing` and
   `monitored_brands.plan`.
4. No new webhook events needed — the existing `/api/stripe/webhook` endpoint +
   `STRIPE_WEBHOOK_SECRET` already receive `customer.subscription.*`.

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
