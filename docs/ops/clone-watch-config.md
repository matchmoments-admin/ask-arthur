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
  _(Superseded by v316: one budgeted fetch step made `UUID_LIMIT` 24 safe, and
  unchanged verdicts back off to 72 h.)_

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

### 4a. "Why were there only N clones last night?" — read this before answering

Asked on 2026-09-07. Answering it wrongly **twice in ten minutes** is what
prompted this section, so the traps are written down rather than the conclusion.

**The number people mean by "reported clones" is `weaponised_at`** — a clone
confirmed as live phishing. Not `first_seen_at` (raw lexical matches, 22–39/day
and healthy) and not `netcraft_declined_at`.

**The honest series is per `weaponised_at` week.** Nothing else. Measured
2026-09-07:

```sql
select date_trunc('week', weaponised_at)::date as wk, count(*) as weaponised
from shopfront_clone_alerts
where weaponised_at > now() - interval '56 days'
group by 1 order by 1 desc;
```

```
Jul 13:  6    Aug 03: 23    Aug 24: 16
Jul 20: 13    Aug 10: 24    Aug 31:  8
Jul 27:  3    Aug 17: 12
```

**Range 3–24 per week.** One or two on a given night is ordinary, not a signal.
Do not react to a single night.

#### Two traps that both produce a false alarm

1. **Never group by `urlscan_scanned_at` and count `weaponised_at IS NOT NULL`.**
   Alerts are re-scanned, so this counts clones weaponised _long before_ that
   scan and inflates recent cohorts. Mean scan→weaponise lag is **−103 hours**
   (median and p90 are **0.0** — weaponisation is stamped at scan time), so the
   negative tail is entirely re-scans.

2. **Never compare a count keyed on one date column against a count keyed on
   another.** Comparing `weaponised_at` windows against `urlscan_classification`
   counted by `urlscan_scanned_at` produced an apparent "detections halved"
   that does not exist.

#### The check that actually indicates health

Conversion from urlscan's verdict to weaponisation, which has been **90–100%
every week**:

```sql
select date_trunc('week', urlscan_scanned_at)::date as wk,
       count(*) filter (where urlscan_classification = 'likely_phishing') as likely_phishing,
       count(*) filter (where urlscan_classification = 'likely_phishing'
                          and weaponised_at is null)                      as unconverted
from shopfront_clone_alerts
where urlscan_scanned_at > now() - interval '35 days'
group by 1 order by 1 desc;
```

Verified 2026-09-07: `unconverted` is 0–2 every week. It climbing is the real
regression signal. A low nightly count with `unconverted` near zero means the
pipeline is working and there was simply less to find.

#### Decompose by lane before concluding anything

`weaponised_at` has two producers: a first scan, and the recheck lane that
re-scans the `monitoring`/`declined` tail (`clone-watch-lifecycle-recheck.ts`)
looking for domains that weaponise _after_ first appearing benign. Split them
before deciding a stage is broken:

```sql
select date_trunc('week', weaponised_at)::date as wk,
       count(*)                                                as weaponised,
       count(*) filter (where coalesce(recheck_count,0) > 0)   as via_recheck,
       count(*) filter (where coalesce(recheck_count,0) = 0)   as via_initial
from shopfront_clone_alerts
where weaponised_at > now() - interval '56 days'
group by 1 order by 1 desc;
```

Measured 2026-09-07:

```
week      total  recheck  initial
07-13         6        6        0
07-20        13        7        6
07-27         3        2        1
08-03        23       18        5
08-10        24       11       13
08-17        12        4        8
08-24        16        6       10
08-31         8        4        4
```

**Both lanes move together**, and the 03–10 August pair (23, 24) is the outlier
against a July baseline of 6, 13, 3. A single stage failing would show as one
lane collapsing while the other held. This is what real-world variation in how
much live phishing exists looks like.

#### Two hypotheses that sound right and are false

Both were proposed from reading the code, and both were killed by one query
each. They are recorded so nobody re-derives them.

1. _"v284 cut off the `declined` inflow, starving the recheck lane of
   candidates."_ Decline inflow per week **rose** across that boundary —
   101 → 305 → 434 (17, 24, 31 August). Check with
   `select date_trunc('week', netcraft_declined_at), count(*) …`.

2. _"v285 flooded the recheck worklist with never-rechecked rows that displace
   the productive `declined` tail, since the worklist orders
   `last_rechecked_at ASC NULLS FIRST` behind a 200-row fetch limit."_
   There are **zero** never-rechecked rows in either cohort (`declined` 1,849,
   `monitoring` 426, both with `last_rechecked_at IS NULL` = 0). Check with a
   `count(*) filter (where last_rechecked_at is null)` grouped by
   `lifecycle_state`.

#### Precision context, so a low rate is not mistaken for a fault

`4c4ce4d7` (v285, 24 Aug) deliberately stopped discarding the pre-weaponisation
tail before urlscan saw it. Submissions went from ~327 to ~1,740 per fortnight
as a result, so **submit→weaponised precision is expected to be low** (~1–3%).
That is the cost of not dropping the tail early, and it is a deliberate
trade — not something to tune back without revisiting v285.

### 4b. Silent-zero shapes — what "ran, did nothing, reported ok:true" looks like per lane

Twice (Sep 9–16 recheck starvation #1127; Sep 12–16 submit budget-at-index-0
#1124) the feature went to zero while every run returned `ok:true` and every
cost row was honest. The detector is Check 4 of `/api/cron/health-digest`
(daily 22:00 UTC, silence-on-healthy, `recordNoAlertNeeded` carries
`lanes_checked` so proof-of-life is unconditional). The **roster and the
per-lane Outcome Row shapes** are `packages/scam-engine/src/lane-outcome.ts`
(`LANES` + `LaneOutcome`; `recordLaneOutcome` is the only writer); the
**predicates** are `apps/web/lib/laneHealth.ts` `LANE_SHAPES`, a mapped type
over the roster — a lane without a shape, or a predicate naming a key the
lane does not write, is a compile error (ADR-0025). Evaluated by ROSTER, so a
lane that stops logging is `absent`, never invisible. **Brake state comes
from `feature_brakes.paused_until`**, not from the row's `braked` field — a
cleared brake otherwise read as braked until the lane's next run.

| lane               | row (`feature / operation`)                     | silent-zero predicate                                                                                                                                   | consecutive |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| lifecycle-recheck  | `shopfront_clone_recheck / recheck_batch`       | `pool>0 ∧ rechecked=0 ∧ rate_limited=0 ∧ dns_unchanged=0`, or `rechecked>0 ∧ submitted=0 ∧ submit_failed>0` (an all-DNS-unchanged run is healthy, v334) | 2           |
| urlscan-submit     | `shopfront_clone_urlscan / submit_batch`        | `units>0 ∧ submitted=0 ∧ rate_limited=0` (`units` is the row column)                                                                                    | 1           |
| urlscan-retrieve   | `… / retrieve_batch`                            | `classified=0 ∧ still_pending>0`, or `unnotified_weaponised>0`                                                                                          | 3           |
| netcraft-issue     | `shopfront_clone_netcraft_issue / issue_report` | `uuids>0 ∧ permanentRejects≥uuids` (the #1157 "not yet" shape); **braked** = `feature_brakes`                                                           | 1           |
| netcraft-resubmit  | `… / resubmit_bulk`                             | `candidates>0 ∧ marked=0 ∧ deferred=0`                                                                                                                  | 1           |
| netcraft-reconcile | `… / lifecycle_reconcile`                       | `uuids=0`                                                                                                                                               | 3           |
| nrd-daily-ingest   | `shopfront_clone_watch / nrd_daily_ingest`      | `domains_scanned=0`, or `failed_chunks≥total_chunks`                                                                                                    | 1           |
| feed-platform      | `clone_watch_feed_entity / feed_batch`          | `pool>0 ∧ written=0` (event-driven: absence is not a signal)                                                                                            | 1           |
| preclassify        | `shopfront_clone_preclassify / classify`        | no row in 26h (per-alert rows; absence is the only readable signal)                                                                                     | —           |

Absence windows: 9h for the 6h lanes, 26h for the daily ones. **Every roster
lane writes one outcome row per run, including its quiet-day path** (`units 0`,
`metadata.reason` ∈ `nothing_due` / `no_gated_candidates` / `nothing_pending` /
`daily_cap_reached` / `none_pending_or_cap` / `all_dead` / `bulk_submit_failed`)
— that is what makes `absent` a real signal. Before that follow-up, prod showed
resubmit row-less on 4 of 13 days and issue on 3 of 13, so "absent" would have
paged on 7 of 13 days for lanes that ran fine. Skip-paths (flag off, brake
engaged, cooldown, no DB) still write nothing on purpose: a disabled lane
_should_ read as absent. Lanes with **no
per-run cost row** (notify-brand, notify-weaponised, enforcement-plan/-execute,
reemergence-monitor, enrich-attribution, report-summary, the
three digests, scan-one) are deliberately NOT in the roster (the per-candidate
submit-netcraft lane that used to be listed here was deleted 2026-09-23) —
a predicate over rows that never exist would be a guard that reads as
protection. Their hop is covered only by `unnotified_weaponised` in
`retrieve_batch`; "every lane logs one outcome row per run" is the graduated
ticket. Predicates read a missing metadata key as 0, so a lane that stops
logging a field reads as zero — loud, not silent.

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

### Flipping a PARKED lane ON — the cron is part of the flip

Three dark clone-watch lanes are **event-only** (cron removed 2026-09-24 so a dark flag stops
burning Inngest runs): `shopfront-clone-enforcement-execute` (restore `15 */3 * * *`;
`FF_CLONE_ENFORCEMENT` + `FF_CLONE_ENFORCE_AUTO_BLOCKLIST`), `shopfront-clone-reemergence-monitor`
(restore `45 6 * * *`; `FF_CLONE_ENFORCEMENT` + `FF_CLONE_REEMERGENCE_MONITOR`) and
`shopfront-clone-weekly-digest` (restore `0 10 * * 0`; `FF_SHOPFRONT_CLONE_WEEKLY_DIGEST`).
Flipping the flag alone does **nothing on a schedule**, and the health digest will then page
the lane as `absent` (its `LANE_SHAPES` `flags` turn on, but no Outcome Row arrives).
The flip is: (1) a PR re-adding `...laneCrons("<lane id>")` to the function's trigger array (the
schedule itself stays declared once, in `LANE_SHAPES.crons` — do not re-type it), with `[build]`
in the commit; (2) after deploy, `curl -X PUT https://askarthur.au/api/inngest` and read the
body; (3) then the env flag.

### Parked Lanes — `LANE_SHAPES[lane].parked` (#1230, 2026-09-26)

A Lane whose schedule does nothing today is **parked**: `parked: "<why>"` in
`LANE_SHAPES`. `laneCrons()` then returns no schedule (the function keeps its
manual-trigger event), and the digest expects no row, so a parked Lane burns
no runs and never pages `absent`. `crons` keeps the schedule to restore:
**un-parking is deleting the `parked` field** (plus `PUT /api/inngest` after
deploy). Parked 2026-09-26: `shopfront-clone-notify-brand-prepare` (no brand
contact until the #1237 readiness gate; 100% `no_unbatched_rows`),
`shopfront-clone-fp-cluster-digest` (no input since 2026-09-04). Also parked,
outside the roster: `known-brands-discover` (100% `all_probed`; its cron line
is commented in the function). `clone-watch-auto-triage` is **retired**, not
parked — see the next section.

### Auto-park lives in the pre-classifier (#1230, 2026-09-26)

`clone-watch-auto-triage` (daily 13:00) is **deleted**. Its confirm half
confirmed **0 alerts ever** (`triage_notes LIKE 'auto-triage:%'` = 0, prod
2026-09-26), and brand contact is on hold until the #1237 readiness gate. Its
one live effect was the **auto-park**: `pending` NRD alerts the pre-classifier
judged `is_clone=false` whose primary signal is weak (not confusable /
levenshtein) → `triage_status='needs_investigation'` with the note
`auto-park: pre-classifier is_clone=false + weak …` (reversible from the admin
triage UI; no event, no fan-out). 244 rows carry that note; the last was
2026-09-23 13:00.

- **Where it runs now:** `shopfront-clone-haiku-preclassify`, at the end of the
  `classify-batch` step, on that batch's `is_clone=false` alerts — one SELECT +
  one bulk UPDATE, `triage_status='pending'` re-checked in the UPDATE's WHERE.
  Code: `apps/web/lib/clone-watch/auto-park.ts` (`isAutoParkEligible` — the cut
  is unchanged, carried over test-for-test in `cloneWatchAutoPark.test.ts`).
  No new step boundary, no flag of its own (it runs whenever the
  pre-classifier does).
- **Fail-soft, not silent:** a failed park never fails the batch; the Outcome
  Row (`shopfront_clone_preclassify` / `batch`) carries `auto_parked` and
  `auto_park_failed`, and the health digest pages on `auto_park_failed`.
- **Why moving it fixed something:** auto-triage read `.limit(200)` of an
  UNORDERED pending set and filtered after. With 938 pending NRD rows it
  parked 0 on 09-24 and 09-25 while 48 eligible rows sat in the queue. The
  per-batch park has no worklist to starve.
- **Backlog:** the 48 rows (prod 2026-09-26: 35 Haiku-judged, 13 Jev-judged,
  first seen 2026-08-25 .. 09-25) are parked once by
  `apps/web/scripts/backfill-auto-park.ts` (dry-run by default, `--apply` to
  write; same `autoParkNotClones` write path; idempotent).
- **Retired with it:** `FF_CLONE_WATCH_AUTO_TRIAGE` (no reader — delete from
  Vercel), `AUTO_CONFIRM_MIN_CONFIDENCE`, the `CloneWatchRunSummary` email (never
  sent), `isCandidateLive` (its only caller). `CLONE_WATCH_SHADOW_RECIPIENT`
  stays (the internal digest reads it). Historical `shopfront_clone_auto_triage`
  cost rows stay in `cost_telemetry`; nothing reads them.
- **Interaction with #1238:** the not-a-clone audit sample (PR #1249, open at
  the time of writing) draws from `is_clone=false` alerts excluding only
  `triage_status='fp'`, so a parked (`needs_investigation`) alert is still
  sampled.

### One declaration per Lane (2026-09-24)

Each roster Lane's **cron schedule**, **flag gate** and **brake key** are declared once:
`LANE_SHAPES[lane].crons` / `.flags` in `apps/web/lib/laneHealth.ts`, and
`LANES[lane].brake` in `packages/scam-engine/src/lane-outcome.ts`. The Lane's
`createFunction` reads `laneCrons(lane)`, its body calls `laneGate(lane)` (skip reason
`"<flagKey> disabled"`), and the health digest reads the same entries — so the digest can no
longer skip a Lane that is running, or expect one on a schedule it doesn't have. The health
window (`expectEvery`) is derived from the crons by `lib/cron-cadence.ts` (sub-daily: 1.5× the
longest gap; daily: +2h; weekly: +24h); only event-driven and monthly Lanes declare it. The
twice-daily reconcile's window tightened 26h → 18h as a result (one missed run now pages, like
every other sub-daily Lane). `shopfront-nrd-daily-ingest` lives in scam-engine and cannot import
laneHealth; `laneHealth.test.ts` pins its cron and flag to the roster instead. An unreadable
`feature_brakes` read is now reported as a `brake_unknown` lane problem rather than read as
"not braked".

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

## 7. Month-over-month — what the report may say (#1226, 2026-09-26)

One gate (`brand-coverage.ts classifyTrend`) and one copy home
(`trend-copy.ts`) decide every "more or less than last month" the report
prints — LinkedIn caption and `/clone-watch/[period]` alike.

- **Prior month = what was PUBLISHED.** The card reads the prior month from the
  frozen `clone_watch_monthly_brand_stats` store (`readFrozenMonths`); only if
  no frozen month exists does it recount live, and `mom.priorSource` says
  which. A live recount drifts as alerts are re-triaged, so the same edition
  read twice could report two deltas.
- **Noise band.** |Δ| / √(this + last) < 2 (`NOISE_Z`) is "about the same" —
  never up/down. Jul→Aug 2026: amazon +3.2σ and revolut −2.5σ were real,
  apple +0.6σ was noise.
- **Floor.** A percentage only when both months have ≥ 10 (`TREND_FLOOR`);
  otherwise the absolute change. (125 of 148 brands sit below it monthly.)
- **Confounders suppress.** A coverage change (watchlist add/remove) or a
  lexical-matcher version change (`matcher_version` on the frozen row) means
  no delta. A classifier change (Haiku→Jev) does NOT — the headline count is
  lexical matches, not classifier verdicts.
- **Feed volume.** When `swept_domains` moved >20% the copy always says part of
  the change is feed size, not attackers (the free feed is capped at 70k/day).
- **Three months.** `mom.series` / claimable `series` carry the last three
  published months; an unpublished month is null and the line is omitted,
  never shown as 0.

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
  - Triage no longer submits to Netcraft: the per-candidate `shopfront-clone-submit-netcraft` consumer was deleted 2026-09-23 (0 runs in 30 days). Netcraft reporting is the 13:00 UTC `shopfront-clone-netcraft-auto` bulk submission below, which `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT` now gates (with `FF_SHOPFRONT_CLONE_NETCRAFT_AUTO` + `FF_SHOPFRONT_CLONE_OUTREACH`).
- **09:30 UTC** — `shopfront-clone-notify-brand-prepare` runs (daily batch builder). Groups queue rows by (brand, recipient), filters via 24h cooldown, caps each group at 50 candidates, fetches `urlscan_evidence` per alert (link + screenshot), renders React Email, freezes subject + html on the queue, transitions to `pending`. Posts ONE summary Telegram pointing the admin at `/admin/clone-watch#approvals`. When `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND=true`, dispatches via Resend on the same tick instead of waiting for admin click.
- **Admin clicks Send** at `/admin/clone-watch#approvals` → `POST /api/admin/clone-watch/batches/[batchId]/send`. Pre-checks (FF + brake + RESEND_FROM_EMAIL), cross-validates recipient against `brand_contact_directory.brand` PK, re-checks STOP suppression, Resend send with `idempotencyKey: clone-watch-send:{batchId}`, transitions batch, records send (stamps `last_notified_at` + `submitted_to.brand_notification.status='sent'`).
- **~~11:00 UTC — urlscan re-scan cron (`shopfront-clone-urlscan-rescan`)~~ (GONE since v178)** — no function with that id is registered. The parked → activated re-scan is `shopfront-clone-lifecycle-recheck` (see `docs/inngest-brakes.md`).
- **10:00 + 22:00 UTC** — `shopfront-clone-netcraft-reconcile` (v217, gated `FF_CLONE_LIFECYCLE_RECONCILE`; second daily run added v284 — see § Submission precision) reads the PER-URL truth from `GET /submission/{uuid}/urls` and advances each submitted clone's `lifecycle_state` by its own `url_state` (`malicious→taken_down` + witnessed `takedown_at`; `no threats`/`unavailable→declined`). This is the single Netcraft verdict source.
- **12:10 UTC** — `shopfront-clone-urlscan-retrieve` (`10 3,9,12,15,21 * * *`) lands the day's urlscan verdicts. This is the evidence the next step reads, which is why it must precede it.
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

> **v320 + PR B "correctness" (2026-09-23) — DNS, send safety, error visibility.**
>
> - **Two DNS verdicts, one Module (`liveness.ts`).** `isDomainGone` is the LIFECYCLE verdict and
>   now means NXDOMAIN only — `ENODATA` (DNS NODATA: the name exists, no record of that type) no
>   longer counts as absence. `resolvesToHost` (A or AAAA present) is the SCANNING verdict: the
>   urlscan precheck in `submitCloneCandidate` skips a name with no A/AAAA (a zone still delegated
>   with its A removed drew urlscan's "400 DNS Error" under the old NS-based check — sucway.net,
>   apple.co.mw, amazom.yoga) and stamps `status 400, error dns_no_host_precheck` (3 rows from
>   before this change carry the old `dns_nxdomain_precheck`). The re-emergence monitor calls a
>   domain re-emerged only when it points at a host again.
> - **Onward sends cannot double-fire.** Every URL-blocklist event carries `id: onward-<ledger row
id>` (Inngest dedups a retried `fire-events` step), and `runUrlBlocklistOnward` claims the row
>   `queued → sending` in its own step before sending — a second event for the same row returns
>   `skipped: not_queued`. A send that exhausts its retries marks the row `failed` (`send_failed`)
>   instead of leaving it `sending`; a resubmit re-drives it (`lib/onward/submit.ts` re-queues
>   BEFORE firing).
> - **The shared daily cap (`CLONE_SUBMISSION_DAILY_CAP`) fails CLOSED** — a
>   `count_todays_takedown_submissions` error throws `shopfront-clone-enforcement-execute` instead
>   of reading as "0 used" — and counts only the sends under our one email identity
>   (`clone_enforcement` `enforcement.queued` + `enforcement.reported`). Netcraft is deliberately
>   OUT: it has its own caps (auto 50/day in its worklist RPC, `NETCRAFT_RESUBMIT_DAILY_CAP`,
>   `count_todays_netcraft_issues`), and the old term counted the deleted
>   `shopfront_clone_submit_netcraft` lane. `enforcement.queued` rows are now AWAITED
>   (`logEnforcementEventAsync`) so the counter cannot miss them.
> - **A worklist read failure is a failure, not a quiet day.** netcraft-auto (both sub-lanes),
>   netcraft-reconcile and the re-emergence monitor now `recordLaneError(lane, err, {stage})` and
>   throw (Inngest retries) instead of writing a quiet Outcome Row over an unread worklist.
> - **v320 `record_netcraft_url_verdicts`:** `unchanged_reads` increments only when the stored
>   read is > 1 h old, so a retried apply step no longer double-counts toward the 72 h backoff.
> - **v320 `project_clone_to_platform_entity`** (SQL twin of `readAttribution`): list-valued
>   registrar → first entry; unparseable `createdDate` / `enriched_at` → NULL instead of raising
>   inside the trigger (which rolled back the enrichment/lifecycle write); a `createdDate` > 1 year
>   before `first_seen_at` is a parent-zone date → unknown (also in `readAttribution` when the
>   caller passes `firstSeenAt`); a sole-source row whose alert is `weaponised` again goes back to
>   `high` + active; a retracted Platform Entity is not projected onto.

> **v317 + PR 4 of the deepening plan (2026-09-23) — spend scans on live names only.**
> `submitCloneCandidate` (urlscan-submit AND lifecycle-recheck) DNS-prechecks the domain via
> `isDomainGone` (liveness.ts): a PROVED-gone name (no A, no NS) skips urlscan and Safe
> Browsing/VirusTotal and is stamped `status 400, error dns_nxdomain_precheck` (superseded by
> v320's `resolvesToHost` / `dns_no_host_precheck`, above) — the same 400
> the v277 dead-domain cadence keys on. Inconclusive resolver answers still scan. v317: a
> recheck-pool row rechecked ≥ 8 times backs off to weekly (514 of 2,087 at apply time).
> urlscan-retrieve now uses `budgetedStep` (was the #1142 spanningBudget constructor bug) and
> runs `10 3,9,12,15,21 * * *` (5/day, dropping the three ticks that always found nothing).
> feed-platform is debounced 2 min. The re-emergence monitor uses the shared DNS check and
> no longer records a resolver timeout as "did not re-emerge". Deferred: preclassify
> `batchEvents` (see the PR — it would land on the lane whose first at-volume Jev run is
> being verified).

> **v316 + PR 3 of the deepening plan (2026-09-23) — one Netcraft Module, batched reconcile.**
> Every report goes through `apps/web/lib/clone-watch/netcraft-report.ts` (endpoint, reporter
> email, body builders, the POST — one timeout, never throws — and `recordAutoSubmission`, which
> also advances `detected|monitoring → reported` where the SQL guard allows). The per-candidate
> `shopfront-clone-submit-netcraft` lane is DELETED (0 runs in 30 days; v284 made netcraft-auto
> the one reporting path). The reconciler fetches up to 24 uuids in ONE budgeted step (4 in
> flight) and writes in ONE step via `planReconcile` (pure, `netcraft-urls.ts`) — ~54 → ~8
> steps/day, finish 15m → 8m. v316: `submitted_to.netcraft.unchanged_reads` counts repeated
> verdicts; ≥ 3 backs the row off to a 72 h cadence, and any change resets it.

> **v314 (2026-09-23) — Netcraft's own verdict and clock are now persisted.** For every
> matched alert the reconciler first calls `record_netcraft_url_verdicts`, writing
> `submitted_to.netcraft.url_state` (`malicious` / `no threats` / `unavailable` / …),
> `url_state_reason` (Netcraft's text, e.g. "Already reported and rejected.") and
> `url_state_at`. When Netcraft's `classification_log` dates the `→ malicious` transition at or
> after the submission (the earlier of our `submitted_at` and Netcraft's own receipt `date`),
> `takedown_at` is stamped from THAT date with `takedown_at_source='netcraft_log'`; v219's
> witnessed `now()` stamp only fills rows the log can't date. A malicious date before the
> submission sets `already_malicious_at_submit` (not our credit; kept out of the TTD KPI).
> Vendor-gap query — sites we watched go live that Netcraft still grades clean:
>
> ```sql
> select submitted_to->'netcraft'->>'url_state' s, submitted_to->'netcraft'->>'url_state_reason' r, count(*)
> from shopfront_clone_alerts where lifecycle_state = 'weaponised' and submitted_to->'netcraft' ? 'url_state'
> group by 1, 2 order by 3 desc;
> ```
>
> First backfill (30 days, 96 alerts, 2026-09-23): weaponised → `no threats` **51** (38 "Already
> reported and rejected."), → `unavailable` 36, → `malicious` 7 (6 vendor-dated, all 11 s–2 min
> after receipt — so "time to takedown" on this cohort is Netcraft's triage latency, not a site
> going offline). **Credit:** reports go out under `NETCRAFT_REPORTER_EMAIL ?? brendan@askarthur.au`
> and Netcraft credits by that email (leaderboard handle `br_4918435`); its crediting emails
> showed 10 sites credited all-time as of 2026-09-22.

> **v329 (#1234, absorbs #1148) — takedown and outcome metrics on one clock each.** Measured
> 2026-09-26 before the change: `clone_watch_takedown_stats(30)` read n=8, **median 0 min,
> fastest −2 min** — it subtracted OUR `submitted_at` (written after the POST returns, 1–142 s
> after Netcraft's receipt) from Netcraft's classification time. It now returns:
>
> | Column(s)                                       | Definition                                                                                                                                        | 30d value at change                     |
> | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
> | `takedowns_total`                               | Netcraft malicious classifications dated in the window                                                                                            | 8                                       |
> | `median/p90/fastest/slowest_minutes`, `timed_n` | Netcraft triage latency, **both ends Netcraft's clock**: `takedown_received_at` → `takedown_at`. NULL when `timed_n = 0`.                         | n=0 (receipt not persisted before v329) |
> | `detect_to_block_*`                             | our `weaponised_at` → vendor-dated `takedown_at`; a site Netcraft blocked before we saw it phishing is `blocked_before_detection`, never averaged | n=7, median 231 min (3.9 h)             |
> | `weaponised_*`                                  | cohort weaponised in the window, by current outcome                                                                                               | 41 → 8 blocklisted, 33 still weaponised |
>
> The public `/clone-watch` tile now shows **detection → blocklist** (n ≥ `MEDIAN_FLOOR` 5),
> labelled "n=7 of 41 weaponised in window", with the sentence that most of that time is our own
> ~13:00 UTC daily Netcraft submit, not Netcraft (`blocklistTile` in
> `apps/web/lib/clone-watch/takedown-stats.ts` — the ONE wording). All three readers go through
> that module; a null is "not measured", never "0 min" — the weekly digest prints "unavailable"
> for a failed read, and `/admin/clone-watch` always shows the cohort tiles with explicit zeros.
>
> **Witnessed offline.** Nothing rechecked a `weaponised` alert (recheck admits monitoring/declined;
> reconcile/issue stop at 30 days): 142 weaponised, 109 weaponised > 30 days ago, 5 rechecked in
> 7 days; a DNS read found 63 NXDOMAIN. The reconcile lane now DNS-reads every weaponised alert
> (≤ 200/run, 20 h cadence, no urlscan quota). First NXDOMAIN sets `offline_since`; a second
> ≥ 12 h later moves it to `dormant` (alert_state `expired`), with `offline_cause` =
> `registrar_hold` when the stored RDAP statuses (`attribution.whois.statuses`) carry a
> client/server hold, else `nxdomain`. Never `taken_down` — that state means "Netcraft classified
> it" to every reader (outcome-copy, squatting, clone-metrics).
>
> **Offline is reversible.** Registrar holds get lifted (13 of the 142 weaponised carried a hold on
> 2026-09-26), and the v315 projection demotes the B2B feed row on `dormant`. So the same DNS pass
> re-reads every offline `dormant` clone weekly; one that resolves again goes back to
> `weaponised` / `open` (`re_emerged` in the Outcome Row) — the only edge out of a terminal state
> (`TERMINAL_EXITS`, lifecycle.ts).
>
> **Current-state counts vs. the dormant move (confounder).** `weaponised` on the report card is
> CURRENT state and is labelled so; it drops as offline clones move to `dormant` (~63 on the first
> runs, i.e. during September 2026). `weaponisedAfterDecline` is now computed from timestamps
> (`weaponised_at > netcraft_declined_at`, `clone-metrics.ts weaponisedAfterDecline`) so its
> membership never erodes as sites die. The month-over-month line (#1247) compares clones, not
> weaponised, and nothing user-facing compares weaponised month-over-month (checked: trend-copy,
> the caption, `/clone-watch/[period]`); the September 2026 caption still carries a one-line
> caveat (`weaponisedStateCaveat`, outcome-copy.ts) so a reader holding August's edition does not
> read the lower figure as fewer attacks.
>
> **No-threat-on-phishing escalation.** 76 weaponised alerts had Netcraft grading them clean after
> its own path ran out (49 "Already reported and rejected.", 27 with our issue on the current
> submission unanswered ≥ 72 h) and **zero** enforcement cases (`shopfront_takedown_attempts` is
> empty — `FF_CLONE_ENFORCEMENT` is dark) or onward reports. The reconcile lane pages the operator
> (≤ 50/run, defanged domains, each with what our DNS last saw — resolves / inconclusive / not yet
> read) and only then stamps `submitted_to.vendor_gap`, once per alert. A failed send returns an
> error in the Outcome Row and stamps nothing, so the rows re-list next run; it never throws.
> Every escalated row is listed on `/admin/clone-watch` (the page names the top 10). The v250
> resubmit lane no longer re-files the "Already reported and rejected." URLs (worklist predicate;
> counted as `rejected_excluded`).
> 72 h because 4 of the 9 issue → malicious conversions ever recorded landed within 71 h.
>
> **#1148 min-age gate — answered with Netcraft's own flag.** Receipt → end of processing over 30
> submissions: 0 min to 12.1 h (median ≈ 5 min; 5 of 30 over 1.5 h). A fixed worklist min-age
> would need ≥ 12 h and delay every filing by it. The issue lane instead defers a submission whose
> `state` is still `processing` (24 h, its own `processing` deferral reason — not the shared
> `transient_state` rounds) before any POST — and before the
> no-escalatable pre-filter, which used to DRAIN such a batch terminally because its
> `state_counts` read only `processing`.
>
> ```sql
> -- the whole outcome picture in one call
> select * from clone_watch_takedown_stats(30);
> -- weaponised clones handed to the operator
> select id, candidate_domain, submitted_to->'vendor_gap' from shopfront_clone_alerts
>  where submitted_to ? 'vendor_gap' order by (submitted_to->'vendor_gap'->>'escalated_at') desc;
> ```

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

### Platform Entity bridge (v309, #1151)

`shopfront-clone-feed-platform` is the PLATFORM-facing consumer of
`shopfront/clone.weaponised.v1` (brand = notify-weaponised, takedown =
enforcement-plan / netcraft-issue). Worklist-driven: every run calls
`list_clone_alerts_pending_platform_entity(50)` (weaponised ∧ not `fp` ∧ no
`submitted_to.platform_entity` stamp) and feeds each row through
`feed_clone_platform_entity` — `scam_entities` domain (+ hosting IP) and a
`scam_urls` row (`confidence_level='high'`, so the 7-day staleness sweep
never expires it), one transaction, stamp included. Gated
`FF_CLONE_WATCH_FEED_ENTITIES`. Telemetry: `cost_telemetry
feature='clone_watch_feed_entity'`, `operation IN ('feed','retract')` per
row and `'feed_batch'` per run (`pool / written / not_written / failed /
cut_off / reasons`). Silent-zero shape: `pool > 0 ∧ written = 0`.

Why the bridge existed for four months without firing: the only writer was
auto-triage's per-alert step behind `triage_status IS NULL`, and the retrieve
lane stamps `tp_actioned` hours before auto-triage runs — 136 of 147
weaponised rows. The worklist above has no triage gate except `fp`.

**Backfill / re-fire (same code path — never a script):**

```bash
curl -X POST https://inn.gs/e/$INNGEST_EVENT_KEY -H 'Content-Type: application/json' \
  -d '{"name":"shopfront/clone.feed-platform.manual-trigger.v1","data":{"source":"operator"}}'
```

50 per fire; the 2026-09-17 backlog of 149 took three.

**Retraction (the reverse; triage `fp` calls it automatically):**

```sql
select retract_clone_platform_entity(<alert_id>);
-- {retracted, entities_deleted, entities_detached, scam_url_deactivated}
```

Withdraws the `clone_watch` source from both rows; DELETEs the entity only
when clone_watch was its sole source and no `report_entity_links` row points
at it; sets the `scam_urls` row `is_active=false` (and `high` → `low`) only
when clone_watch was its sole source. Stamps `platform_entity.retracted_at`,
which also keeps the alert out of the worklist forever.

**Verify:**

```sql
select count(*) filter (where entity_type='domain') domains,
       count(*) filter (where entity_type='ip') ips
  from scam_entities where 'clone_watch' = any(feed_sources);
select count(*) from scam_urls where feed_sources @> '{clone_watch}' and is_active;
select count(*) from list_clone_alerts_pending_platform_entity(500);  -- expect 0 after backfill
```

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
(`lib/clone-watch/liveness.ts`). All-dead uuid →
non-terminal `netcraft_issue.recheck_after` (+72h; revived sites re-enter,
permanent deadness converges via the 30-day `submitted_at` window) — the
one-per-submission issue slot is never spent on a dead site. Partial-live →
files the live subset; dead candidates stamp `skipped: 'dead_at_probe'`
(they forfeit that uuid's slot — the POST already consumed it). Dry-run logs
`liveCount/deadCount/deadDomains`.

**Verdict semantics (v248).** The probe returns `true` / `false` / `null`, and
**only NXDOMAIN is `false`**. Callers apply their own policy: the issue reporter
files on `live !== false`; a conservative caller reads `live === true`.

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
| `NETCRAFT_RESUBMIT_DAILY_CAP`            | server env  | `15`    | Bare number — `parseInt("$10")` is `NaN` and falls back to the default.                                                                                                                      |
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
> `shopfront_clone_netcraft_resubmit_error`, rows left unmarked, retried next
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
                  'shopfront_clone_netcraft_resubmit_error')
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
batch 90/run → ≤360 unlisted urlscan submits/day since #1231; 50/run before)
is the declined→weaponised detector — the enabler for F1 and the F4 evidence
gate.

> **Throughput caps (#1231, 2026-09-26).** urlscan's real limits (read from
> `/user/quotas`): unlisted **60/min, 100/hour, 1,000/day**; retrieve 120/min,
> 5,000/h, 10,000/day. Two unlisted caps bind: **per minute** (a submit is
> ~1.5–2.2 s, so width 3 unpaced would push ~80/min — recheck paces one start
> per 1.1 s, ~55/min) and **per hour** (a batch stays ≤90; the manual-trigger
> cooldown is 65 min so two batches never share an hour, and
> `pipeline-urlscan-enrichment` moved to 03/15/21:00, off the recheck's :30
> hours). Sizes now: recheck 90/run at width 3 paced, retrieve 100/run × 5 at width 3 (the first 429 stops every
> worker), submit 75/day (unchanged), reconcile 40 uuids/run, resubmit 15/day,
> enricher 60/day **oldest-first** (newest-first let its tail age out of the
> 35-day window). Every capped lane writes `cap` + `cap_reached` in its
> Outcome Row (enricher also `backlog`); the health digest pages `cap_bound`
> when a cap binds N runs running and the backlog is not draining. Recheck is
> exempt: its designed cadence asks ~3,800 rescans/day (≈4× the daily quota),
> so it records `due_total` (v328) instead — the fix is change-triggered
> rescans (#1229), not a bigger cap.

#### Change-triggered rechecks — the DNS gate (v334, #1229 part 2a)

Each run DNS-reads up to **600** due rows before spending any urlscan quota
(`RECHECK_DNS` in `apps/web/lib/clone-watch/recheck-dns-gate.ts`; lookups are
`probeStockDns` in `liveness.ts` — A, AAAA only when A has none, always NS).
The fingerprint reduces addresses to their **/24 (IPv4) and /48 (IPv6)** and
two reads MATCH when NS is identical and the address sets overlap. That rule
is measured, not guessed: on 400 due pool names read twice 11 minutes apart
(2026-09-26), exact strings flagged 15 "changes" that were all pool rotation —
Afternic anycast answering one member of its pair, Hostinger parking
(`*.dns-parking.com`) handing out a fresh address in the same /24 and /48 on
every query, Vercel rotating inside 216.150.1.0/24 + 216.150.16.0/24. The
prefix-and-overlap rule gave 0 of 354.

Per row (planUrlscanRechecks in the lane file):

| DNS read                                                  | urlscan?                  | stamp                                            |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| unchanged, not floor-due                                  | **no**                    | `recheck_dns_checked_at` only (`dns_unchanged`)  |
| changed                                                   | yes, ahead of everything  | baseline + both clocks after the attempt         |
| unknown (SERVFAIL / timeout / refused)                    | yes — the gate fails open | as above; an unknown read keeps the old baseline |
| no baseline (never rescanned since v334)                  | yes                       | as above                                         |
| any read, **floor-due** (7 d if < 14 days old, else 30 d) | yes                       | as above                                         |
| not reached by the DNS phase                              | only if floor-due         | none — it stays due                              |

Up to 90 urlscan rows/run, as before (changed rows first, then risk order
with the 20% stale-floor reserve on the URLSCAN clock). Eligible rows past the
cap are left unstamped (`deferred`) and lead the next run.

**Two clocks.** `last_rechecked_at` / `recheck_count` stay the URLSCAN recheck
clock (the floor, the v317 weekly tier and the dead-domain cadence key on
them). `recheck_dns_checked_at` is the DNS clock. The worklist's queue clock is
`GREATEST` of the two (NULLs ignored — both NULL = never checked = first).

**Floor evidence** (66 decline→weaponise flips): 26 within 7 days, 13 in days
7–14, 22 in days 14–45, 5 after 45. The floor bounds only the flips that do
NOT move DNS (content swapped on the same host); DNS-visible flips are caught
at the DNS cadence.

**Reading a run** (Outcome Row metadata): `dns_checked`, `dns_unchanged`
(urlscan calls saved), `dns_changed`, `dns_unknown`, `dns_no_baseline`,
`floor_due`, `deferred`, `dns_unreached`, `dns_ms` (the DNS phase's wall
clock — raise `RECHECK_DNS.limit` from this, the cadence wants ~1,000/run).
`due_total` is now "due for a recheck of either kind". Expect
`dns_no_baseline` ≈ the whole slice for the first ~5–6 days after deploy
(every row needs one rescan to set its baseline — the lane behaves as before
meanwhile), then `dns_unchanged` to dominate.

```sql
-- DNS gate health, last 3 days
SELECT created_at, metadata->>'dns_checked' checked, metadata->>'dns_unchanged' unchanged,
       metadata->>'dns_changed' changed, metadata->>'dns_unknown' unknown,
       metadata->>'dns_no_baseline' no_baseline, metadata->>'floor_due' floor_due,
       metadata->>'submitted' submitted, metadata->>'deferred' deferred,
       metadata->>'due_total' due, metadata->>'dns_ms' dns_ms
FROM cost_telemetry
WHERE feature = 'shopfront_clone_recheck' AND created_at > now() - interval '3 days'
ORDER BY created_at DESC;
```

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

### Stranded-count invariant — run this after ANY worklist predicate change

`clone_watch_urlscan_stranded_count` renders on /admin/clone-watch under the
words "no automated lane will retry". It has regressed three times (v274: 75%
overstatement, v286: 95%, v292: ~99%) and the cause was identical every time —
a worklist was widened and one of the metric's three legs was not. The union is
`count(*) FILTER (WHERE a OR b OR c)`, so no test of the RPC's own output can
catch this; the check has to compare against the live worklists:

```sql
WITH stranded AS (
  -- keep in step with clone_watch_urlscan_stranded_count's predicate
  SELECT id FROM shopfront_clone_alerts a
   WHERE a.source = 'nrd' AND a.lifecycle_state <> 'dormant'
     AND a.urlscan_uuid IS NOT NULL
     AND a.urlscan_submitted_at IS NULL
     AND a.urlscan_classification IS NULL
     AND NOT (a.lifecycle_state IN ('monitoring','declined')
              AND a.first_seen_at >= now() - interval '90 days')
     AND a.lifecycle_state NOT IN ('taken_down','weaponised')
)
SELECT
  (SELECT count(*) FROM stranded) AS stranded_rows,
  (SELECT count(*) FROM stranded s
     WHERE s.id IN (SELECT id FROM list_clone_alerts_for_recheck(1000, 6, 168)))
    AS also_in_recheck,   -- MUST be 0
  (SELECT count(*) FROM stranded s
     WHERE s.id IN (SELECT id FROM list_clone_alerts_pending_urlscan_submit(100, 0.7, 3)))
    AS also_in_submit;    -- MUST be 0
```

Last run 2026-09-03 after v293: `stranded_rows=1, also_in_recheck=0,
also_in_submit=0`. A non-zero right-hand column means the metric is lying
again — fix the leg, do not adjust the copy.

**Related honesty bound.** `clone_watch_vendor_gap_stats`' decline→weaponise
leg admits only pairs whose `netcraft_declined_at` is at or after
**2026-08-09T21:31Z** — v273's measured apply instant, when
`advance_clone_lifecycle` stopped re-stamping that column on every no-op
recheck. Earlier stamps measure the 6h recheck cadence, not the vendor gap, and
the originals are unrecoverable. The TS twin
(`apps/web/lib/clone-watch/duration-kpis.ts`, `DECLINE_CLOCK_TRUSTWORTHY_SINCE`)
carries the same bound because it feeds the report card and the persisted
monthly `clone_watch_report_summary`; keep the two in step.

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

### Not-a-clone audit (v330, #1238)

**Why.** A pre-classifier `is_clone=false` verdict parks an alert in `detected`
and nothing ever scans it: the submit worklist requires `c.is_clone`, and the
recheck worklist only covers `monitoring`/`declined`. A false negative was final
and invisible. Decision #1233 (founder, 2026-09-26): measure it with a one-off
random ~100 sample, then keep a ~5% weekly sample.

**The audit is MEASUREMENT (lead decision, PR #1249 review).** A miss is
surfaced for human review. It is never acted on externally under the brand
label the classifier rejected. The rule lives where the transition is decided:
v330's `apply_clone_urlscan_verdict` sends a `likely_phishing` verdict on a
**sampled alert whose classification is still `is_clone=false`** to
`monitoring` (from `detected`; `monitoring`/`declined` stay put). It never goes
to `weaponised` and never sets `weaponised_at`. So none of the weaponised
consumers can reach it: the retrieve emit (keyed on `weaponised_at`),
feed-platform (`scam_urls`/`scam_entities`), notify-weaponised,
enforcement-plan and the Netcraft lanes. That holds whichever path persisted
the verdict: retrieve, the submit lane's reputation fallback, or a later
recheck. The miss is stamped on the sample row (`miss_at`). The daily submit
lane reads unsurfaced misses (`list_clone_not_a_clone_audit_unwarned_misses`),
ships one **always-ship Axiom warn** per miss (`clone-watch.not-a-clone-audit.miss`,
via `getLogger` inside the `surface-audit-misses` step, flush awaited — the
console logger survives ~1 h in Vercel and is not a record), writes their ids to
the Outcome Row (`audit_misses`, `audit_miss_ids`), and only THEN stamps
`miss_warned_at` (`mark_clone_not_a_clone_audit_misses_warned`). A run that
dies in between re-presents the miss; a replay does not re-ship the warns. The
branch fails CLOSED: only an explicit re-judgement to `is_clone=true` lets a
sample weaponise — a NULL or missing classification stays measurement. If a
sample is re-judged `is_clone=true`, the normal edges apply again.

**Reporting keeps samples out of brand counts (#1256).** A sample's verdict is
not a fact about the brand the classifier rejected. Before #1256, the monthly
cohort counted `urlscan_classification` for every NRD alert. That would have
put an audit miss in the published per-brand `likely_phishing` count, for
example threesbrewingdirect.shop under ing.com.au.

Every cohort read now embeds `clone_watch_not_a_clone_samples(miss_at)` in the
same PostgREST request (`AUDIT_SAMPLE_EMBED` in `CLONE_COHORT_SELECT`,
`apps/web/lib/clone-watch/clone-cohort.ts`). `applyCohortRules` passes every
row through `withholdAuditVerdict`. A row is withheld when it is sampled and
still `is_clone IS NOT TRUE`, the same predicate v330 uses. A withheld row:

- stays in `clones` / `detected`, because it was a lexical match;
- reads `urlscan_classification`, `urlscan_evidence` and `urlscan_uuid` as null,
  so it counts as `unclassified`, like every unsampled not-a-clone;
- has `lifecycle_state` `monitoring` read back as `detected`. The draw takes
  only `detected` alerts, so the move to `monitoring` came from the audit scan.

This covers every surface built on the cohort: the report card and summary
row, the caption, `/clone-watch/[period]`, the monthly brand store
(`buildTrendRows` → `write_clone_watch_monthly_stats`), targeting intelligence,
the stewardship watch-list and the internal digest. The outreach pilot sample
(`brand-outreach-pilot.ts`) and the month-end stock status (`month-end-stock.ts`)
carry the same embed and apply the same predicate.

When a month has withheld rows, the report-card fetch logs
`report-card: audit samples withheld from brand counts` as an always-ship warn
with `withheld` and `misses`. The misses themselves are counted per cohort key,
not per brand, by `clone_watch_not_a_clone_audit_summary()`. A
re-classification to `is_clone=true`, or an operator confirmation
(`tp_confirmed` / `tp_actioned`), releases the sample into the brand counts on
the next fold.

A failed read never publishes a miss under the brand. The marker rides in the
cohort query, so the month fetch throws and the job retries.

**Prod, queried 2026-09-26.**

- 607 `source='nrd'` alerts are `detected`, `is_clone=false`, with no urlscan
  uuid and no classification.
- 129 of them carry `triage_status='fp'` (one bulk pass on 2026-09-04). They
  are **excluded** from every draw, which leaves **478**, 371 of them inside 90
  days.
- 588 of the 607 were judged by **Haiku** and 17 by **Jev**, so the baseline
  mostly measures the retired classifier. Read the summary's `classifier`
  column before quoting a number about Jev.
- New `is_clone=false` alerts arrive at about 25–35 a week.

**How it runs (no new cron).** The daily `shopfront-clone-urlscan-submit` lane
(09:00 UTC) does the following:

- Its load step draws the weekly sample (flagged), reads unsurfaced misses, and lists
  `due` samples (`list_clone_not_a_clone_audit_pending`).
- It asks the regular worklist for the full 75, so v285's oldest-rows reserve
  keeps its size. `composeSubmitBatch` gives samples at most
  `AUDIT_SLOTS_PER_RUN` = 25 slots and trims the regular list's freshest tail
  to fit. Trimmed rows sets `cap_reached`.
- Samples run **after** the regular batch as a **separate tally**. `units`,
  `submitted` and `dns_*` on the Outcome Row describe regular rows only. The
  audit has its own fields: `audit_offered`, `audit_attempted`,
  `audit_submitted`, `audit_dns_skipped`, `audit_submit_failed` and
  `audit_rate_limited`. This keeps a day of DNS-dead samples from reading as
  `silent_zero`.
- **Attempts:** every sample the lane tried (anything but a 429) gets
  `attempts + 1`. A sample with no verdict is re-offered after 168 h, up to 3
  attempts. Never-tried samples go first, then the longest-waiting retry.
- A sample is **unscannable** only when its attempts are exhausted with no
  verdict. A lost stamp still waits out the cadence, because the state also
  reads urlscan's `attempted_at` (failed attempts) and `urlscan_submitted_at`
  (successful submits).
- Every state comes from ONE function,
  `clone_watch_not_a_clone_audit_sample_states()`, which both the worklist and
  the summary read.

**Volume and quota.** Samples mostly fill **otherwise-empty** slots. Only 33
regular rows were eligible between runs on 2026-09-26. So while samples are
due, the lane makes **up to 25 more urlscan submits a day**, plus their
retrieves (the retrieve lane takes up to 100 per run, 5 runs a day). urlscan's
unlisted limits are 60/min, 100/hour and 1,000/day:

- The run stays at 75 submits or fewer.
- It runs in the 09:xx UTC hour, which **no other urlscan lane shares**. The
  recheck lane fires at :30 of 00/06/12/18.
- Submits are sequential, each behind a DNS precheck and a reputation lookup.
  75-row runs have taken 3–6 minutes, so the run stays well under 60/min.
- The baseline 100 drains in about 4 runs.

**Benign samples and the recheck lane.** A benign verdict moves a sample
`detected → monitoring`, which puts it in the recheck pool (90-day horizon).
That lane is at its cap every run, with about 1,420 due. v330's
`list_clone_alerts_for_recheck` (re-created from v328, `due_total` kept)
treats sampled not-a-clones as low-yield: **weekly** cadence, and their clock
starts at the audit scan (`COALESCE(last_rechecked_at, urlscan_scanned_at)`).
A freshly scanned sample therefore does not jump the NULL-first queue.

**Operator: run the one-off baseline.** Do this after v330 is applied and this
PR is deployed. It is a write, so run it as service_role in the SQL editor:

```sql
-- Marks ~100 random never-scanned, non-fp not-a-clones. Idempotent per label.
SELECT public.draw_clone_not_a_clone_audit_sample('baseline', '2026-09', 100);
```

Nothing else needs triggering: the next 4 daily submit runs carry the samples.
Never stack manual fires in one hour.

**Read the FN rate** about 5–6 days after the draw:

```sql
SELECT * FROM public.clone_watch_not_a_clone_audit_summary();
-- weekly samples of the last 30 days, for #1237:
SELECT * FROM public.clone_watch_not_a_clone_audit_summary(now() - interval '30 days')
 WHERE cohort = 'weekly';
-- misses to review (also in Axiom: clone-watch.not-a-clone-audit.miss;
-- and cost_telemetry submit_batch metadata->'audit_miss_ids'):
SELECT alert_id, miss_at, cohort_key, model_id FROM clone_watch_not_a_clone_samples
 WHERE miss_at IS NOT NULL ORDER BY miss_at DESC;
```

The summary returns one row per cohort key × classifier × age band (`0-30d`,
`31-90d`, `90d+` at draw time). Sum the rows as needed.

- `fn_rate` = misses / scanned. A **miss** is the FIRST urlscan verdict after
  the draw being `likely_phishing`. It is read from
  `clone_watch_scan_transitions`, and the per-verdict counts sit beside it.
- `unscannable` = 3 attempts, no verdict. Expect it to be large, because about
  half of clone-watch domains do not resolve. Always quote the rate with its
  denominator (`scanned`).
- `pending` = due, waiting for the cadence, or in flight.
- `phishing_later` = the first verdict was benign, but a later one was
  `likely_phishing` (the recheck lane caught it; it is still not weaponised).
- `weaponised_later` = `weaponised_at IS NOT NULL`. That is only possible if
  the alert was later re-judged `is_clone=true`.

**Weekly sample.** Set `FF_CLONE_WATCH_NOT_A_CLONE_AUDIT_WEEKLY=true` on Vercel
(server-side) and redeploy. It draws 5% of the unsampled, non-fp, never-scanned
not-a-clones first seen in the last 90 days, minimum 1. That is about 18–20
rows at today's pool, drawn once per UTC ISO week.

**Rollback.**

- Turning the flag off stops new weekly draws.
- To stop scanning drawn samples:
  `UPDATE clone_watch_not_a_clone_samples SET attempts = 3 WHERE miss_at IS NULL AND attempts < 3;`
- Re-applying v200's `apply_clone_urlscan_verdict` removes the miss routing.
  Do this only after deciding what misses should do instead.

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

### Monthly brand store — frozen months + re-publish (v319)

`clone_watch_monthly_brand_stats` (+ `_registrar_stats`) is the ONE per-brand
monthly store. `clone-watch-report-summary` (cron `0 11 1 * *`) is its only
producer and writes it through `write_clone_watch_monthly_stats`, which
**freezes** the month (`frozen_at`). Everything that prints a per-brand monthly
clone number reads it — including the brand-stewardship ledger, which now runs
on the producer's completion event (`clone-watch/monthly-store.written.v1`)
instead of its own cron two hours earlier.

What frozen means, and what enforces it:

| Situation                                                      | What happens                                                                                         | Enforced by                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Scheduled run, month not yet published                         | summary upserted, store written + frozen, event emitted                                              | `clone-watch-report-summary.ts` → `write_clone_watch_monthly_stats` (v319)        |
| Any run (retry, backfill, manual) for a frozen month           | **nothing written** — not the store, not the summary row                                             | `readMonthFrozenAt` early return + the writer's `status: "frozen"` refusal (v319) |
| Direct SQL / script UPDATE, DELETE or INSERT on a frozen month | raises `check_violation`                                                                             | trigger `clone_watch_brand_stats_freeze_guard` (v319)                             |
| Manual `{ periodMonth, republish: true }`                      | restated, `frozen_at` re-stamped, `previous_frozen_at` warn-logged to Axiom, stewardship re-prepared | `p_republish` (v319)                                                              |

The freeze is an INTENT guard against accidental restatement, not an access
control: the writer lifts it for its own transaction through the
`app.clone_watch_republish` setting, and service_role could do the same.

**Re-publish a month deliberately** (a methodology fix you WANT reflected in a
published month — say so in the edition's caveat):

```bash
# $KEY = the Inngest event key (see § Manual ad-hoc trigger above)
curl -X POST "https://inn.gs/e/$KEY" -H "Content-Type: application/json" \
  -d '{"name":"clone-watch/report-summary.manual-trigger.v1","data":{"periodMonth":"2026-08","republish":true}}'
```

Then check the run output for `storeStatus: "republished"` and
`previousFrozenAt`, and that `report-brand-stewardship` ran for the month.

**Backfill a month that was never published** — same event without
`republish`. On a frozen month that is a no-op (`skipped: "frozen"`).

Column semantics that are easy to misread:

- `weaponised` = cohort members **currently** weaponised when frozen (a later
  takedown removes them); `weaponised_ever` = members with `weaponised_at` set.
- `taken_down` = members **first seen** this month that are taken down, dated or
  not; `taken_down_in_month` = distinct lookalikes of the brand (any first-seen
  month) whose `submitted_to.netcraft.takedown_at` falls **in** the month.
  Undated takedowns (68 of 91 in prod on 2026-09-23) are not in
  `taken_down_in_month`, and it is only attached to brands with ≥1 detection
  that month. NULL = the takedown events could not be read (not measured).
- `brand` is the primary DOMAIN; `brand_normalized` is the Canonical Brand key.
  A domain shared by several brands (`servicesaustralia.gov.au`) is one row
  keyed to its owner.
- Jun/Jul/Aug 2026 were frozen by the migration at their
  `clone_watch_report_summary.generated_at` (2026-09-04 — the day all three
  were last restated); their v319 columns were backfilled from live data on
  the day v319 was applied.

**August 2026 brand-stewardship batch is missing.** The 1 Sep 09:00 run was
cancelled at its then-4m finish timeout (Inngest `function.cancelled` at
09:05:44, slot starvation — ADR-0019 2026-09-02 amendment); cancelled runs get
no retry and nothing re-fired it. After v319 is applied and this code is
deployed, re-fire it once:

```bash
curl -X POST "https://inn.gs/e/$KEY" -H "Content-Type: application/json" \
  -d '{"name":"report/brand-stewardship.manual-trigger.v1","data":{"periodMonth":"2026-08-01"}}'
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

## 8c. Jev pre-classifier — primary since 2026-09-22 (ADR-0026; shadow lane v311)

**Now (ADR-0026).** TypeSafe Jev IS the pre-classifier. With
`FF_CLONE_WATCH_JEV_PRIMARY=true` the fn runs one `classify-jev` step
(`lib/clone-watch/jev-classify-one.ts::classifyPrimaryWithJev`): one vendor
call → the v157 `clone_watch_classifications` row every gate reads
(`confidence` = **P(clone)**, `model_id` = `jev-1.13.0`, `reason` synthesized)
→ the v311 raw-probability row → one cost row `shopfront_clone_preclassify` /
`typesafe`. No Claude call. Vendor or gate-row failure logs
`shopfront_clone_preclassify_error` and THROWS (Inngest retries; the daily
selector re-fans tomorrow) — the Haiku path's recovery semantics, unchanged.

**Thresholds — one home:** `apps/web/lib/clone-watch/preclassify-thresholds.ts`
(`IS_CLONE_MIN_P` 0.4 · `WORKLIST_MIN_CONFIDENCE` 0.4 — urlscan-submit, dormant
sweep, netcraft-auto · `RISK_INDICATOR_MIN_P` 0.5; `AUTO_CONFIRM_MIN_CONFIDENCE`
0.8 retired with auto-triage, #1230). `preclassifyThresholds.test.ts` fails if a
consumer grows a local literal. The evidence for each number is in the module
header. **Retune** = edit the module, re-run the gate simulation below, PR.

**Rollback:** set `FF_CLONE_WATCH_JEV_PRIMARY=false` on Vercel prod (PR with
`[build]`). The Haiku path + Jev shadow tail resume exactly as before; rows Jev
already wrote keep `model_id='jev-…'`; the 0.4 gates then read Haiku's
confidence (≤ 5 historical Haiku rows sit in [0.4, 0.7)). The shadow tail has no
absence watch of its own in rollback mode (accepted, unattended).

**Gate simulation** (re-run before any retune):

```sql
with shared as (
  select (a.weaponised_at is not null) w, (a.triage_status='fp') fp, j.is_clone_p p
  from shopfront_clone_alerts a join clone_watch_jev_classifications j on j.alert_id=a.id)
select t as min_p, count(*) filter (where p>=t) n,
       count(*) filter (where p>=t and w) weaponised, count(*) filter (where p>=t and fp) fp
from shared, unnest(array[0.3,0.4,0.5,0.6,0.7,0.8]) t group by t order by t;
```

---

**How we got here — the shadow lane (v311, 2026-09-21).** A second classifier run beside the Haiku pre-classifier on the
identical input, persisted, and **read by nothing in the product path**. It
exists to be measured. Vocabulary: a _shadow lane_ (`CONTEXT.md`).

**Why.** Haiku's `confidence` gates four worklist RPCs (`>= 0.7`), auto-triage
(`>= 0.9`) and `computeWeaponisationRisk`, and has no predictive power over
outcomes. Prod, 2026-09-20, all 3,496 `clone_watch_classifications` rows:

| Haiku says              |     n | weaponised later | triaged FP |
| ----------------------- | ----: | ---------------: | ---------: |
| clone, conf 0.8–1.0     | 2,255 |         137 (6%) |        171 |
| clone, conf 0.6–0.8     |   649 |          17 (3%) |        166 |
| not clone, conf 0.8–1.0 |   565 |                1 |        119 |

TypeSafe **Jev** is a decision-only model whose output is a calibrated
probability (RLCD-trained), $0.042/M input tokens, output free, ~0.1–0.5 s.
Vendor benchmarks are self-reported; this lane is how we get our own.

**Where.**

- The tail of the `persist` step in `apps/web/app/api/inngest/functions/clone-watch-haiku-preclassify.ts` (folded rather than a fourth boundary — each boundary queues 30–60 s for a slot under contention, #1069; the body is fail-soft + UPSERT-idempotent so a step retry is harmless). Body: `apps/web/lib/clone-watch/jev-shadow-one.ts` — `classifyOneWithJev`, the ONE write path shared with the backfill. Gated `FF_CLONE_WATCH_JEV_SHADOW` (**ON in prod since 2026-09-22**; sub-flag of `FF_SHOPFRONT_CLONE_PRECLASSIFY`).
- Adapter `packages/scam-engine/src/providers/jev.ts`; rubric `apps/web/lib/clone-watch/jev-preclassify.ts` (`JEV_PROMPT_VERSION`); vocabulary shared with Haiku in `apps/web/lib/clone-watch/preclassify-vocabulary.ts`.
- Table `clone_watch_jev_classifications` + RPCs `record_clone_watch_jev_classification`, `clone_watch_jev_calibration()` — `supabase/migration-v311-clone-watch-jev-shadow.sql`.
- Secret `TYPESAFE_API_KEY` (Vercel, Sensitive). Missing key ⇒ every row skipped as `no-key`.

**Observability.** Success: `cost_telemetry WHERE feature='shopfront_clone_preclassify_jev'` (provider `typesafe`, `units` = input tokens, metadata `is_clone_p`, `model_id`, `latency_ms`). Failure: `$0` rows under `shopfront_clone_preclassify_jev_error` with `metadata.reason` ∈ `no-key | timeout | rate_limited | http_error | bad_shape | bad_answers | persist_failed`. The fn return carries `jev: "off" | "ok" | "error"`. The backfill script is also the lane's **repair tool**: a live 429/timeout leaves no Jev row and the daily fan-out only re-fans alerts with no _Haiku_ row, so re-running the script closes live gaps. Spend rolls into `SHOPFRONT_CLONE_OUTREACH_CAP_USD` → `feature_brakes.shopfront_clone_outreach` (filter list in `cost-daily-check/route.ts`, pinned by `costDailyCheckJevBrake.test.ts`).

**Day-1 curve (backfill).** Every historic row's input is stored, so:

```bash
pnpm --filter @askarthur/web exec tsx scripts/backfill-jev-classifications.ts            # dry-run
pnpm --filter @askarthur/web exec tsx scripts/backfill-jev-classifications.ts --apply --limit 25
pnpm --filter @askarthur/web exec tsx scripts/backfill-jev-classifications.ts --apply     # ~3.5k calls, ≈ $0.02
```

Rows land with `source='backfill'`; the live step writes `source='live'`. Keep them separable — the backfill is the answer, the live cohort is the confirmation.

**The decision instrument.**

```sql
select * from clone_watch_jev_calibration() order by classifier, bucket;
```

> **FROZEN since v313 (found 2026-09-22, documented v314).** Its `model_id NOT LIKE 'jev%'`
> filter sits in the CTE BOTH sides project from, so once Jev writes the gate row the alert
> vanishes from both curves. It remains the reproducible day-1 comparison. **For the 30-day
> threshold revisit use the live instrument** — one curve per `model_id` over the gate rows
> (`clone_watch_classifications.confidence`), uniform buckets, no prefix filter:
>
> ```sql
> select * from clone_watch_preclassify_calibration('2026-09-22 09:00+00') order by model_id, bucket;
> ```
>
> Outcomes (urlscan, weaponised, Netcraft) mature over days, so read a cohort ≥ 14 days old.

One row per (classifier, probability bucket) over the alerts BOTH classifiers scored. `haiku` bucket 0 = `is_clone=false`; buckets 1–10 = confidence deciles. `jev` buckets 1–10 = `is_clone_p` deciles. Bucket k = [(k-1)/10, k/10), 1.0 folded into 10 — **v312** fixed the edges (v311's `1.0001` bound + float32 REAL put every exact decile one bucket low; the table on PR #1172 predates the fix, the corrected one is on #1173). Columns: `n`, `urlscan_phish`, `weaponised`, `netcraft_declined`, `triaged_fp`, `tp_actioned`.

**Decision rule (fixed 2026-09-20, before any data).** Adopt Jev as the confidence source — a later PR that swaps the worklist gates' input, with its own ADR — **only if** `weaponised / n` and `urlscan_phish / n` rise monotonically across Jev's buckets where Haiku's stay flat. If Jev's curve is also flat, or the top-bucket weaponisation rate is not clearly above Haiku's, **delete the lane**: unset the flag, drop the step + modules, drop the table (v3xx), remove the two feature tags from the cap filter. Do not leave a measured-and-failed lane running.

**Activation (2026-09-22).** Backfill done (3,501 rows, ≈ $0.17); the curve met the decision rule (see PR #1172's closing comment for the full table + gate simulation). `TYPESAFE_API_KEY` (Sensitive) and `FF_CLONE_WATCH_JEV_SHADOW=true` are set on Vercel prod; the live-step PR carries the `laneHealth.ts` `ABSENCE_WATCHES` entry (`shopfront-clone-haiku-preclassify:jev-shadow`, feature `shopfront_clone_preclassify_jev`, 26 h) and a `[build]` commit so the deploy picks the vars up. Deactivating = unset the flag AND remove the watch in the same PR, or the digest pages daily.

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
- `apps/web/app/api/inngest/functions/clone-watch-*.ts` — the clone-watch Inngest functions (list them with `ls`; the per-function brakes live in [`docs/inngest-brakes.md`](../inngest-brakes.md)). The original seven named here (`submit-netcraft`, `notify-brand`, `notify-brand-prepare`, `poll-netcraft`, `weekly-digest`, `urlscan`, `urlscan-rescan`) are no longer the set: `submit-netcraft` (2026-09-23) and `poll-netcraft` (#1069) are deleted, and `urlscan` / `urlscan-rescan` became `urlscan-submit` / `urlscan-retrieve` / `urlscan-scan-one` (v178)
- `apps/web/app/api/admin/clone-watch/batches/[batchId]/send/route.ts` + `.../reject/route.ts` — admin-approval endpoints powering `/admin/clone-watch#approvals`
- `apps/web/app/api/admin/clone-watch/scamwatch-export/route.ts` — CSV export for Scamwatch manual upload (PR #484; auto-submit tracked in [#485](https://github.com/matchmoments-admin/ask-arthur/issues/485))
- Open issues: [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409) v3 matcher word-boundary fix · [#426](https://github.com/matchmoments-admin/ask-arthur/issues/426) Netcraft observability · [#427](https://github.com/matchmoments-admin/ask-arthur/issues/427) TOAST sibling-table · [#428](https://github.com/matchmoments-admin/ask-arthur/issues/428) handler tests · [#429](https://github.com/matchmoments-admin/ask-arthur/issues/429) stale-queue dashboard · [#430](https://github.com/matchmoments-admin/ask-arthur/issues/430) Phase C inbound handler · [#434](https://github.com/matchmoments-admin/ask-arthur/issues/434) urlscan evidence audit trail
- BACKLOG.md #25 (flip `/clone-watch` to indexable after #371 v1 copy) + #26 (re-evaluate cross-surface dedupe with `brand_impersonation_alerts`)
