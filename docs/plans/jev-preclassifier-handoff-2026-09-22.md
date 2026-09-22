# Handoff — Jev pre-classifier swap + the review it opened (2026-09-22)

Written at the end of the session that took TypeSafe Jev from "a thing Brendan
saw on the internet" to "the classifier that gates four clone-watch worklists".
Everything below is either SHIPPED (merged + live in prod) or OPEN with the
next action named. Numbers are prod query output with the date they were run.

---

## 1. What shipped

Four PRs, all merged to `main`, all live:

| PR                                                                  | What                                                       | Migrations |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| [#1172](https://github.com/matchmoments-admin/ask-arthur/pull/1172) | Shadow-lane schema, vendor adapter, rubric, day-1 backfill | v311       |
| [#1173](https://github.com/matchmoments-admin/ask-arthur/pull/1173) | Live shadow tail, flag, brake wiring, absence watch        | v312       |
| [#1174](https://github.com/matchmoments-admin/ask-arthur/pull/1174) | **The swap** — Jev is the pre-classifier (ADR-0026)        | v313       |
| (branch) `clone-watch/auto-triage-lane-outcome`                     | auto-triage Outcome Row — **pushed, PR not opened**        | —          |

### The decision, and the evidence for it

`clone_watch_classifications.confidence` gates four worklists (`>= 0.7`),
auto-triage's auto-confirm (`>= 0.9`) and `computeWeaponisationRisk`. Haiku's
number had no predictive power. Jev's does. Full population, 3,526 alerts,
v312 decile edges (prod, 2026-09-22):

| classifier | bucket               | n    | weaponised % | FP %    |
| ---------- | -------------------- | ---- | ------------ | ------- |
| haiku      | 0 (`is_clone=false`) | 596  | 0.2          | 21.6    |
| haiku      | 8                    | 632  | 2.5          | 25.6    |
| haiku      | 9                    | 1196 | 4.7          | 10.4    |
| haiku      | 10                   | 1097 | 8.1          | 4.4     |
| jev        | 4                    | 344  | 1.5          | 23.3    |
| jev        | 5                    | 521  | 1.9          | 20.7    |
| jev        | 6                    | 654  | 3.4          | 13.9    |
| jev        | 7                    | 707  | 5.1          | 9.9     |
| jev        | 8                    | 629  | 7.6          | 5.4     |
| jev        | 9                    | 331  | **11.8**     | **0.6** |

Haiku puts 83% of rows in three bins with a flat curve; Jev is monotone across
nine deciles. Cost $0.000048 vs $0.00248/call (52×), p95 405 ms vs ~3 s.
Reproduce with `select * from clone_watch_jev_calibration() order by 1,2`.

**Caveat that matters for any future retune:** the outcome labels
(`weaponised_at`, `urlscan_classification`) come from urlscan, which only ever
saw rows _Haiku's gate admitted_. Jev's recall on Haiku-rejected rows is
unobserved; the bias favours Haiku, so the real gap is likely wider, not
narrower.

### How it runs now

```
08:30 UTC  shopfront-nrd-daily-ingest ──► ≤50 events/day
                                          shopfront/clone.preclassify-requested.v1
                                                    │
   clone-watch-haiku-preclassify  (fn id unchanged — see §3e #14)
     FF_CLONE_WATCH_JEV_PRIMARY=true  ──►  ONE step `classify-jev`
        classifyPrimaryWithJev()  [lib/clone-watch/jev-classify-one.ts]
          askJev → toClassificationRow → record_clone_watch_classification (v157)
                                      → record_clone_watch_jev_classification (v311)
                                      → 1 cost row  shopfront_clone_preclassify / typesafe
          failure ⇒ $0 `_error` row + THROW ⇒ Inngest retry ⇒ tomorrow's selector re-fans
     flag OFF  ──►  the Haiku path + Jev shadow tail, byte-for-byte as before  = ROLLBACK
```

Gates retuned, all four reading **one** module
(`apps/web/lib/clone-watch/preclassify-thresholds.ts`):

| gate                                         | was (Haiku) | now (Jev P(clone)) | effect                                      |
| -------------------------------------------- | ----------- | ------------------ | ------------------------------------------- |
| urlscan-submit, dormant sweep, netcraft-auto | `>= 0.7`    | `>= 0.4`           | n 2923→2857, weaponised 160→156, FP 334→305 |
| auto-triage auto-confirm                     | `>= 0.9`    | `>= 0.8`           | n 1083→346, weaponised 88→40, **FP 47→2**   |

### Proof it works in prod

- Production deployment `ms02bdx54` = `githubCommitSha c6aed47b`, READY, aliased to `askarthur.au`.
- Inngest run `01M34811SMGY…` for the smoke event returned `{"jev":"primary","ok":true,"confidence":0.73}` — the string `"jev":"primary"` exists only in #1174's code.
- Alert 4209 (`krakena.top` vs `kraken.com`): row written with `model_id='jev-1.13.0'`, `confidence 0.73`, `typosquat` / `crypto_scam`, reason `jev p=0.73 · typosquat (0.85) · crypto_scam (0.75) · suspicious_tld, new_registration`; one `typesafe` cost row at $0.000047; **zero** `anthropic` rows for that alert.
- Gate lanes ran post-swap on the retuned thresholds without starving: urlscan `submit_batch` 09:04 UTC → 22 submitted; netcraft-auto 13:02 → 1 candidate, 1 marked (the v284 evidence gate expects ~1–2/day).

---

## 2. The one thing still unproven

**The at-volume run has not happened yet.** As of 2026-09-22T19:29Z the only
Jev-written gate row is the single smoke (alert 4209); the other 26 rows in the
last 30h are Haiku's, written before the swap deployed at 08:54 UTC.

**First real test: 08:30 UTC 2026-09-23**, ~25–50 alerts. Check:

```sql
-- expect ONLY jev-1.13.0
select model_id, count(*) from clone_watch_classifications
where classified_at > now() - interval '1 day' group by 1;

-- expect ~25-50 typesafe rows, ZERO anthropic, ZERO *_error
select feature, provider, count(*), round(sum(estimated_cost_usd)::numeric,4)
from cost_telemetry where feature like 'shopfront_clone_preclassify%'
  and created_at > now() - interval '1 day' group by 1,2;
```

If the fn throws on every alert (bad key, vendor outage), the symptom is
`shopfront_clone_preclassify_error` rows + an absent `classify` stream → the
daily health digest pages on the `shopfront_clone_preclassify` absence watch.
**Rollback is `FF_CLONE_WATCH_JEV_PRIMARY=false` on Vercel prod** (PR with
`[build]` in the commit message — the ignore-step skips env-only changes).

---

## 3. Open work, in priority order

### 3a. 🔴 SHIPPED BUG — v313 froze the decision instrument (fix first)

`clone_watch_jev_calibration()` is named as _the_ decision instrument in ADR-0026,
in `preclassify-thresholds.ts:22` and in the backfill script. **It can no longer
observe a single primary-mode alert.**

v313 added `WHERE h.model_id NOT LIKE 'jev%'` intending to keep the _haiku side_
honest. But the clause sits in the `shared` CTE, which is the single population
**both** sides project from — and in primary mode `classifyPrimaryWithJev` writes
_both_ rows, so `h.model_id = 'jev-1.13.0'` and the alert is dropped entirely.

Proven against prod, 2026-09-22:

```
both_rows (h ⋈ j)                3551
visible_to_calibration           3550   ← the 1 Jev-written alert is dropped
jev_written_gate_rows               1
fn reports for classifier='jev'  3550
```

So the two commitments —ADR-0026 §Consequences _"revisit 0.4 / 0.8 after 30 days
of `source='live'` rows"_ and `preclassify-thresholds.ts:22` — have no instrument.

**The fix is a design decision, not a one-liner**, which is why it is written up
rather than rushed out at the end of a session. The tension: filtering per-side
makes the two curves cover _different populations_, and equal populations are the
precondition for the comparison being meaningful. Recommended shape (v314):

- Keep a **cohort** notion explicit. The pre-swap cohort (Haiku gate row + Jev
  shadow row) is what the day-1 decision used and should stay reproducible;
  the live cohort (Jev gate row, `source='live'` raw row) is what the 30-day
  revisit needs and has **no Haiku counterpart at all** — nothing to compare it
  against, so a two-classifier curve is the wrong shape for it.
- Concretely: either add `p_cohort text default 'pre_swap'` and branch the
  predicate, or split into `clone_watch_jev_calibration()` (frozen, pre-swap,
  keep as-is and say so in the COMMENT) plus a new
  `clone_watch_preclassify_calibration()` that takes the **live** rows and bins
  `clone_watch_classifications.confidence` against outcomes with no
  classifier UNION — a single calibration curve for whatever classifier is
  currently writing. The second is what the 30-day revisit actually wants.
- Whichever is chosen, `LIKE 'jev%'` is a prefix match on a vendor-controlled
  string (`res.model`; `jev.ts:36-38` warns the alias can move). A
  `typesafe-jev-2.x` would silently re-break it. Prefer keying the era on
  `prompt_version` (ours: `jev-v1`) or a dedicated column.

Also inherited from v311/v312 and worth fixing in the same migration: the two
sides' buckets are not like-for-like at the bottom — the haiku side collapses
all `is_clone = false` rows into bucket 0 while the jev side has no boolean gate
and `width_bucket(0,0,1,10)` returns 1, so jev can never produce bucket 0.

### 3b. OPEN PR-less branch: `clone-watch/auto-triage-lane-outcome` (pushed, d2e02c76)

Ready to open. Found by reviewing the shipped state against prod:
`shopfront_clone_auto_triage` has **never** written a `cost_telemetry` row —
its only `logCost` is the Resend run-summary nested inside the shadow-email
conditional. So the one gate whose threshold the swap moved (0.9 → 0.8) had no
proof of life; a mis-set threshold would present as silence, and silence was
already normal. `laneHealth.ts` listed auto-triage among lanes deliberately
outside the detector, pointing at "the graduated ticket" — **#1145, which is
CLOSED with those lanes still unlisted**, so the prose described a plan that
had stopped existing.

The branch adopts ADR-0025's pattern: roster entry + typed `LaneOutcome`,
`recordLaneOutcome` on both paths (including the quiet `no_eligible` one, so
"found nothing" and "never ran" stop looking alike), silent-zero shape
`eligible>0 ∧ confirmed=0 ∧ offline=0`. Web 1,839 + scam-engine 948 green,
go-red verified. **Next action:** `gh pr create`, `[build]` not needed (no env
change).

### 3c. The guard gap this review uncovered — **24 of 47 app-local Inngest functions are missing from `docs/inngest-brakes.md`**

```
billing-ingest-nightly · brand-register-refresh · clone-watch-auto-triage
clone-watch-internal-digest · clone-watch-report-summary · cost-telemetry-retention
feed-retention · feedback-triage-refresh · known-brands-discover
phone-footprint-retention · reddit-processed-posts-retention · regulator-alert-push
report-onward-acma-email-spam · report-onward-apwg · report-onward-auto-report
report-onward-brand-abuse · report-onward-markers · report-onward-openphish
shopfront-clone-fp-cluster-digest · shopfront-clone-notify-brand
shopfront-clone-reemergence-monitor · shopfront-clone-submit-netcraft
shopfront-clone-weekly-digest · telco-events-retention
```

Reproduce: scan `id: "..."` across `apps/web/app/api/inngest/functions/*.ts`
and grep each against the doc. The file's own header says _"A MISSING ROW IS
WORSE THAN A BLANK CELL"_, and the 2026-07-29 enterprise review found 36 of 76
missing — but the guard it produced
(`apps/web/__tests__/inngestBrakesMatrixDrift.test.ts`) only asserts the
`inngestFunctions` array from scam-engine. Its own header admits this: _"The
`appFunctions` array declared locally in route.ts is not importable without
pulling the Next.js route module into vitest … Extending this to cover both
arrays is the goal."_ So the app-local half re-drifted to 24.

**The fix is a fitness function, not 24 doc rows.** Extend the drift test to
derive ids by scanning the function-file sources (the header warns a naive
`createFunction(` regex undercounts — scan for `id: "…"` inside
`inngest.createFunction({…})` and assert a floor count so an empty scan can't
pass vacuously). Then add the missing rows; most fields are mechanically
extractable (`cron`/`event`, `concurrency`, `rateLimit`, `throttle`,
`idempotency`, the `featureFlags.x` read, presence of `logCost`, the
`isFeatureBraked` key).

Same shape as the defect I fixed in #1173, where `shopfront-clone-haiku-preclassify`
itself turned out to have no row.

### 3d. Parked deliberately (not bugs, decisions)

- **Rename `is_clone_p` / `source`** on `clone_watch_jev_classifications`. `p_` (RPC param) and `_p` (probability) collide in one identifier; `source` means "run cohort" here but "detection feed" on `shopfront_clone_alerts`, and the two are JOINed in the calibration fn. The column is live with 3.5k rows — do it with the next migration that touches the table.
- **Derive `SYSTEM_PROMPT` from `preclassify-vocabulary.ts`.** The Haiku prompt hand-writes the same enum one-liners the vocabulary module holds; the test only pins value _names_, so descriptions can drift (they already differ slightly). Deferred because editing the prompt bumps the Haiku cohort, which is now rollback-only.
- **A fleet `recordLaneError` helper.** There are 3+ hand-rolled shapes for "$0 error row" (`classify-haiku`'s catch, `classifyOneWithJev`'s `fail()`, `logFunctionFailure`) plus ≥6 inline `feature: "…-error"` literals, and the suffix convention is inconsistent (`_error` vs `-error`) against the health-digest's `%error%` matcher. Same class ADR-0025 fixed for outcome rows.
- **Revisit the 0.4 / 0.8 thresholds after 30 days of `source='live'` rows.** Gate-simulation SQL is in `docs/ops/clone-watch-config.md` § 8c.

### 3e. The rest of the architecture review's findings (completed; nothing below is fixed)

Ordered by what would bite hardest. §3a above is finding #1 from this pass.

**Correctness / latent**

1. **8 surviving `DEFAULT 0.7` on the gated RPCs** — `v178:34`, `v184:31`,
   `v185:26`, `v258:44`, `v279:55`, `v284:46`, `v285:68,176`, `v286:66`.
   Behaviour today is correct because all three TS call sites pass the arg
   explicitly, but on the P(clone) scale 0.7 is a _much_ tighter cut (≈916 rows
   vs 2,857). Any new caller, ops `psql`, or a dropped named arg silently
   reverts — the worklist-starvation class the ADR itself cites (v224, v252).
   `preclassifyThresholds.test.ts` cannot see SQL at all.
2. **`mark_stale_clone_alerts_dormant` now runs a Jev-tuned 0.4 over a 100%
   Haiku population** — its scope is `first_seen_at < now() - 90 days`, so for
   ~90 days every row it judges is pre-swap. A looser cut retires _more_ old
   alerts to `dormant`/`expired` than last week. The ADR's "≤5 Haiku rows in
   [0.4, 0.7)" figure is about _rollback_ and does not cover this backlog.
   Nobody has looked at how many rows this is retiring — **check it**.
3. **Auto-park is an invisible fifth consumer of `IS_CLONE_MIN_P`.**
   `clone-watch-auto-triage.ts:176-226` selects `.eq("is_clone", false)` with no
   literal (so the thresholds guard is green), but `is_clone` is now
   `p >= 0.4`. Two problems: its conservative-cut justification ("~1% of
   confirmed clones were is*clone=false") was measured on \_Haiku's* boolean and
   has not been re-measured; and it writes up to 200 rows/run.
4. **The auto-park note persisted to the DB is now false on every row it
   stamps**: `"auto-park: Haiku is_clone=false + weak (non-confusable/
levenshtein) signal…"` (`auto-triage.ts:217`). That is operator-facing
   evidence in `triage_notes`, not a comment. One-line fix.
5. **`isPreclassifyBraked` fail-closed writes no telemetry.** A Supabase blip on
   `feature_brakes` returns `true` → the fn returns `{skipped, cost_brake_engaged}`
   → **zero rows, zero cost rows, no `_error`**. Indistinguishable from a real
   brake; the only signal is the 26h absence watch. Precisely the failure class
   the `_error` row exists to prevent.

**Docs / naming drift (all shipped in the last three PRs)**

6. `jev-shadow-one.ts` was renamed to `jev-classify-one.ts`, but
   `docs/system-map/database.md:491`, `docs/system-map/background-workers.md:199`
   and `docs/ops/clone-watch-config.md:1343` still point at the old path, and
   `cloneWatchJevShadowStep.test.ts:4` cites `jevShadowOne.test.ts`, which no
   longer exists.
7. `docs/inngest-brakes.md:65` Brake cell still says the brake is _"read inline
   in `classify-haiku`"_ — in prod it is read in `classify-jev`. The Kill cell
   was updated for ADR-0026; the Brake cell was missed.
8. `feature-flags.ts` `cloneWatchJevShadow` docstring still says "every
   Haiku-classified candidate is also sent to Jev" with no mention that
   `cloneWatchJevPrimary` supersedes it. The flag inventory is the first thing
   read during an incident.
9. `cost-daily-check/route.ts:291-300` comment says "aggregate across 8
   sub-features … Haiku pre-classifier" — the list is now 10 and the
   pre-classifier is not Haiku.
10. **"Annotate, don't backfill" has no enforcer.** The ADR commits to marking
    the 2026-09-22 discontinuity in trend/targeting output; grepping
    `ADR-0026` / `discontinuit` finds 21 hits, **all in comments** and zero in
    any report-generating or rendering path. September 2026 is the first
    monthly report to straddle the break and nothing will say so. This is the
    `apps/web/CLAUDE.md` rule ("a sentence asserting a control must name what
    enforces it") applied to an ADR consequence.

**Design / weight**

11. **Feature-name constants with zero production importers.**
    `PRECLASSIFY_COST_FEATURE`, `PRECLASSIFY_ERROR_FEATURE`, `JEV_COST_FEATURE`,
    `JEV_ERROR_FEATURE` (`jev-classify-one.ts:40-46`) read as a source of truth,
    but `cost-daily-check/route.ts:313-317` and `laneHealth.ts:193` hard-code the
    same strings; only the test imports them. **A constant whose only importer is
    its own test is not a seam** — rename the value and the brake aggregator
    silently stops counting while every test passes.
12. **`jev-classify-one.ts` is two modules in one file.** `classifyPrimaryWithJev`
    throws; `classifyOneWithJev` returns a tagged union and never throws — for
    the same failure classes. A caller must know which discipline applies, which
    of two cost features their spend lands under, that primary is _partially_
    fail-soft (the v311 raw-row failure is a `logger.warn`, a third discipline
    inside the "not fail-soft" function), and that neither reads the brake. The
    20-line docstring exists because of the split.
13. **The rollback path is the best-tested code that cannot run.**
    `SYSTEM_PROMPT` + `ClassificationOutputSchema` have 10 dedicated tests and are
    unreachable with the flag ON; the prompt re-lists the vocabulary in prose and
    its tests re-list it again as literals, so the vocabulary now has **three**
    copies. Deleting the Haiku path would _concentrate_ (not merely move) the
    vocabulary, remove the second validator, and drop clone-watch's last
    dependency on Anthropic. Do it after one clean release on Jev — not before.
14. **Renaming the fn id is not free** (`shopfront-clone-haiku-preclassify` now
    names the rollback). Inngest durable state + `idempotency: "event.id"` are
    keyed on it, `withAxiomLogging`'s `fnId` is a _separate literal_ nothing
    asserts matches, and the drift guard would not catch a mismatch. If done: one
    PR, roster + docs + both literals in the same commit.

**Test truth**

15. `preclassifyThresholds.test.ts` is a source-scan proxy. It _does_ catch an
    inline `p_min_confidence: 0.7`. It does **not** catch: `1.0` (the regex needs
    a leading `0` or bare `.`), single-quoted `'confidence'`, `let` instead of
    `const`, a differently-named local (`MIN_CONF`), any indirection, any
    comparator other than `.gte("confidence", …)`, or **any file outside the
    3-file list** — including all of `lib/clone-watch/*` and every `.sql`.
    Nothing asserts a call site passes the argument _at all_, so deleting
    `p_min_confidence: MIN_CONFIDENCE` entirely passes every test and reverts
    that worklist to the SQL default of 0.7 (see #1).
16. Genuinely well covered: the primary path **is** tested end-to-end through the
    real handler with the real `jev-classify-one` (`cloneWatchJevShadowStep.test.ts:256-324`)
    — step list, no-Claude, both RPCs in order, cost row, brake-before-vendor,
    throw-on-failure. Only the file name and its header still say "shadow".

**Observability**

17. The health-digest `%error%` aggregator **does** pick up
    `shopfront_clone_preclassify_error` ✓, but it keys on `feature|operation` and
    **drops `provider`** — so Haiku-era and Jev-era failures aggregate into one
    bucket and the digest cannot say which vendor is failing.
18. `/admin/costs` aggregates on `feature|provider`, so the pre-classifier now
    shows as **two rows** for any window spanning 09-22. Not a bug; expect it
    before someone reads it as an unreconcilable cost change.
19. The absence watch is provider-blind by design — it proves _a_ classifier ran,
    not _the_ classifier. A rollback keeps it green.
20. **Rollback is not observability-neutral**: flipping primary OFF re-activates
    the shadow tail, whose own absence watch was removed. Accepted in the ADR,
    but worth knowing at 2am.

---

## 4. Things that will bite the next person

- **`jevai.org` is a community site, not the vendor.** Its `jev_…` key returns `401 authentication_error` on `api.typesafe.ai`. Real keys come from `console.typesafe.ai/keys` and start `apik…`. Cost me a full debug cycle.
- **Jev `noul` `criteria` must be `{true, false}`**, not a prose string → `422 model_attributes_type`. The two-question probe passed; the full 10-question rubric didn't.
- **Instructions count as input tokens.** ~1,100/row, not the ~150 I first estimated — the full backfill was $0.17, not $0.02.
- **`width_bucket(REAL, 0, 1.0001, 10)` puts every exact decile one bucket low** (float32 stores 0.9 as 0.89999997; the `1.0001` bound shifts every edge). Fixed in v312 with `LEAST(width_bucket(round(x::numeric,6), 0, 1, 10), 10)`. The table originally posted on #1172 carries the shift; the corrected one is on #1173.
- **A go-red can be a FALSE pass.** Mine was: prettier had collapsed a multi-line predicate onto one line, so the "break it" edit silently matched nothing and the suite stayed green. Always assert the edit landed (`grep -c`) before trusting the red.
- **The fn id is still `shopfront-clone-haiku-preclassify`** and the file is still `clone-watch-haiku-preclassify.ts`, though Haiku no longer runs by default. Renaming is NOT free: the id is the Inngest durable-state key and appears in `docs/inngest-brakes.md`, `laneHealth.ts` (`ABSENCE_WATCHES`), the drift test, and Axiom queries. Left deliberately; if renamed, do it as its own PR with the roster and docs in the same commit.
- **Vercel preview can fail on a transient Google-Fonts fetch** (`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, `archivo`). It is not your code — `vercel redeploy <url>` clears it. Happened once on #1174.
- **A filter in a shared CTE filters every branch that projects from it.** v313's
  `WHERE h.model_id NOT LIKE 'jev%'` was written to scope one side of a UNION and
  silently scoped both (§3a). When a CTE feeds a `UNION ALL` of projections, a
  per-branch predicate belongs in the branch, not the CTE.
- **A constant whose only importer is its own test is not a seam** (§3e #11).
- **PostgREST anti-join** (used by the backfill's worklist): `.select("id, jev:sibling_table(alert_id)").is("jev", null)` works when the sibling FKs the parent. Verified 0 pending / 3,526 has-jev / 3,526 total.

---

## 5. Where everything lives

| Thing                                                 | Path                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Decision record                                       | `docs/adr/0026-jev-is-the-clone-watch-preclassifier.md` |
| Runbook: activation, rollback, retune, gate-sim SQL   | `docs/ops/clone-watch-config.md` § 8c                   |
| Vendor adapter (never throws, `rate_limited` ≠ dead)  | `packages/scam-engine/src/providers/jev.ts`             |
| Both write modes + shared brake read                  | `apps/web/lib/clone-watch/jev-classify-one.ts`          |
| Rubric, answer→row mapping, RPC args (pure)           | `apps/web/lib/clone-watch/jev-preclassify.ts`           |
| The four thresholds + their evidence                  | `apps/web/lib/clone-watch/preclassify-thresholds.ts`    |
| Shared enums (Haiku schema derives from these)        | `apps/web/lib/clone-watch/preclassify-vocabulary.ts`    |
| Backfill **and the lane's repair tool**               | `apps/web/scripts/backfill-jev-classifications.ts`      |
| Schema, calibration fn, decile fix, haiku-only filter | `supabase/migration-v311/v312/v313-*.sql`               |
| Glossary: "shadow lane", "pre-classifier confidence"  | `CONTEXT.md`                                            |

Prod env (Vercel, all set): `TYPESAFE_API_KEY` (Sensitive),
`FF_CLONE_WATCH_JEV_PRIMARY=true`, `FF_CLONE_WATCH_JEV_SHADOW=true` (rollback
mode only).

Ad-hoc prod SQL in this repo: `pnpm --filter @askarthur/web exec tsx scripts/_query.ts --sql "…"`
(untracked session tooling; needs `SUPABASE_ACCESS_TOKEN`).
