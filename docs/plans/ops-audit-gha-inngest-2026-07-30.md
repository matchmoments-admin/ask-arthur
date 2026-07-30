# Ops audit — GitHub Actions + Inngest/cron fleet

**Date:** 2026-07-30
**Method:** 6 parallel read-only auditors (GHA cost, GHA correctness, scraper health, Inngest config, Inngest liveness, alerting) → 6 adversarial verifiers → synthesis. 73 findings survived verification; 2 were refuted outright and are recorded in §6 so they are not re-investigated.
**Companion doc:** [infrastructure-residency-and-cost-strategy.md](./infrastructure-residency-and-cost-strategy.md) (PR #876). This audit does not restate the residency/Bedrock analysis — it changes that plan's **sequencing**, covered in §4.

**Standard of evidence.** Every claim below is grounded in an observation — a run count, a row count, a query result, or an exact config line. Where something could not be observed it is in §6 marked UNVERIFIED, not asserted. This standard exists because the dominant defect class this audit found is _a document or comment asserting a control that no code enforces_ — the same class as `c393be8`.

**Calibrated Actions rate: US$0.00603/billable-min**, derived by reconciling 4,762 reconstructed billable minutes against the US$28.734 actual `infra_cost_daily` charge for Jul 2–28. This is 25% below list; see §6 for why that matters. Anything re-derived at the US$0.008 list price is 33% high.

---

## 0. Status — updated 2026-07-30 after verification

Verification against prod caught one defect in the remediation itself, and two
live consumer bugs the audit had not found. Recorded here so a cold reader knows
which parts of §2–§4 are already closed.

**Shipped (PRs open, all CI green unless noted):**

| PR   | Covers                                           | Notes                                                         |
| ---- | ------------------------------------------------ | ------------------------------------------------------------- |
| #879 | §2.5 §2.6 §2.8 §3 (GHA lane) + §2.1 watchdog     | Includes the crt.sh revert-then-retire sequence below         |
| #880 | §2.4 backoff latch                               | Verified against prod: acsc streak = 1,928h vs a 24h cooldown |
| #881 | §2.2 + §5 Check 1–2 (`alert_delivery_log`, v260) | Applied to prod                                               |
| #883 | §2.3 health-digest (v261)                        | Stacked on #881 — merge that first                            |
| #882 | NEW — see below                                  | Two live consumer surfaces                                    |

**Migrations applied to prod: v260, v261, v262.** Advisors re-run after each; the
only new entries are expected `rls_enabled_no_policy` INFOs (service-role-only by
design, matching 30+ existing operational tables). No new ERRORs or WARNs.

**The remediation defect worth reading.** Retiring crt.sh — which the audit
recommended on the evidence of 0 new rows in 55 days — would have silently
removed **1,726 AU brand-lookalike domains** from the blocklist.
`mark_stale_urls` deactivates on `last_seen_in_feed`, and crt.sh's daily touch
was the only thing keeping its findings active; `is_active = TRUE` gates
`/api/scam-urls/lookup`, `/api/v1/threats/domains` and
`/api/v1/threats/urls/trending`. **Discovery volume and retention are separate
jobs, and a dead-for-discovery feed can still be doing the second one.** Reverted,
then fixed properly by v262 (`feed_sources.staleness_exempt`), then retired.

Before retiring or slowing ANY feed, run this first:

```sql
select s feed, count(*) active_sole_source, max(last_seen_in_feed)
  from scam_urls, unnest(feed_sources) s
 where is_active and array_length(feed_sources,1)=1 group by 1 order by 2 desc;
-- and the same over scam_ips
```

Swept 2026-07-30: `phishing_army` 157,660 · `ipsum` 148,847 · `phishtank` 62,019
· `urlhaus` 19,239 · `asic_investor` 4,018 · `openphish` 3,945 · `crtsh` 1,726 ·
`spamhaus` 1,655 · `abuseipdb` 1,192 · `reddit` 16. ~400k active rows verified
safe. `phishing_database` and `feodo` are sole source for **zero** active rows,
which is what makes those two retirements genuinely free.

**Two live bugs the audit missed, both found by curling prod (#882):**

1. `gateOrNotFound()` on a statically prerendered route is evaluated at **build**
   time and baked into HTML. 6 of 8 gated routes had no `dynamic` export, and
   `/charity-check` served HTTP 200 while both its API routes returned 503 off
   the _same_ flag — a public search box where every query failed.
2. The `/scam-feed` "ACSC" filter matched `source='acsc'`, which has **zero rows
   lifetime**. Restored to `inbound_acsc`, where ACSC content actually arrives.

**Still open from §4:** PR6 (required status checks), PR7 (brake canary drill),
PR9 (upsert recency guard), PR11–PR15. Revised GHA saving: **~US$13.50/mo**
config-only, with crt.sh's US$1.77 now genuinely removed rather than relabelled.

**Founder actions that block the rest:** rotate the Slack webhook; add
`ANTHROPIC_API_KEY_EVAL`; create the R2 bucket + four `R2_DR_*` secrets +
`ENABLE_DR_DUMP=true`. Until those land, promptfoo, the vulnerability workflow
and the new DR watchdog go **red by design** — they were failing all along.

---

## 1. Do this first, before reading the rest

**A live Slack webhook has been world-readable for 132 days.** It is stored as a repo **variable**, not a secret, so Actions does not mask it: `gh variable list` prints the full URL, and the `notify-failure` step's env dump writes it verbatim into the logs of a **public repo** (`gh repo view` → `"visibility": "PUBLIC"`, verified 2026-07-30). Run 29949808190 contains the literal line at 2026-07-22T19:13:29 followed by `ok` — a Slack 2xx under `curl -sf`, so **the webhook is live**. Exposed since 2026-03-20; present in 11 `notify-failure` logs in July alone.

Blast radius is bounded — post-only, one channel, no read access — which is the only reason this is not P0. But rotation is a founder action and nothing else in this document should happen first.

1. Rotate the webhook in Slack.
2. `gh variable delete SLACK_WEBHOOK_URL` → `gh secret set SLACK_WEBHOOK_URL`.
3. Point `scrape-feeds.yml:261-263` and `scrape-vulnerabilities.yml:96-98` at `${{ secrets.… }}`, and move the emptiness guard into the step body — `secrets.*` cannot be referenced in an `if:`.
4. Verify: `gh variable list | grep -c SLACK` → `0`; force one failure and confirm the log shows `***`.

Better still, retire it — the other six alerters already use Telegram, and §6 notes 20 consecutive unactioned failures in this channel over 4.5 months.

---

## 2. What is actually broken

Ranked by consequence. The first four are safety nets that do not exist.

### 2.1 There is no off-Supabase backup, and never has been — 83 days

`dr-pg-dump.yml` shows **83 of 83 scheduled runs `conclusion=skipped`**, 2026-05-08 → 2026-07-29, zero gaps, zero manual dispatches (verified directly, 2026-07-30). The job gate is `vars.ENABLE_DR_DUMP == 'true'`; that variable **is not among the repo's 6 variables**, so the expression is `'' == 'true'`. All four `R2_DR_*` secrets are likewise absent from the 16 repo secrets, so a manual dispatch would die at pre-flight too. **A GitHub `skipped` conclusion emits no notification of any kind** — it renders as a grey tick, not a failure.

DB is 2,390 MB. Cost to close: **~US$0.75–1.00/month (≈A$1.15–1.55)** — a control costing under A$2/month has been dark for 83 days on a public repo where the Actions minutes are free.

`docs/ops/pending-manual-setup.md:110-125` already records this as P3 on the assumption PITR suffices. The genuinely new facts are that (a) `skipped` will never page, so this state is self-concealing, and (b) the quarterly drill is **29 days past its own scheduled date** — `docs/ops/dr-plan.md:96` sets 2026-07-01 and the drill log at :92-95 reads `| (none yet) | | | |`.

**Fix:** create the R2 bucket (Object Lock + versioning), add the four secrets, `gh variable set ENABLE_DR_DUMP --body true` (bare lowercase, no trailing newline — it is an exact string compare), dispatch once and confirm the "Verify upload" step. Then add a weekly watchdog that pages when the newest successful dump is >48h old.

### 2.2 Every operator alert is fire-and-forget

All alerts funnel through `sendAdminTelegramMessage` (`apps/web/lib/bots/telegram/sendAdminMessage.ts:13-31`), which returns `Promise<void>`, catches every error into `logger.error`, and returns normally. `logger` is console-only — no Axiom transport. Zero cron routes import `getLogger`, despite `AxiomSource` declaring an `api/cron` source. An `information_schema` sweep for `%alert%`/`%digest%`/`%notif%`/`%cron%`/`%sent%`/`%deliver%` returns 9 tables, all domain-purpose: **nothing records that an operator alert was delivered.** ~35 non-test call sites. Vercel runtime-log retention is ~1 day.

"Did the alert fire?" is currently an unanswerable question. This single defect is why the founder's own gate on plan steps 7–8 is correctly placed — see §4.

### 2.3 `health-digest` reported "all clear" while three non-muted feeds were 31–86 days dead

The most-corroborated finding in the audit — three auditors reached it from three different angles. Four independent structural failures:

- **(a)** Staleness is computed from `MAX(created_at)` of **any** status, not the last success (`route.ts:185-215`). The latched backoff (§2.4) writes a fresh `partial:backoff_active` row every ~1.8h, so `acsc` reads as permanently 1.8h fresh while having **zero success rows in 1,167 lifetime runs**.
- **(b)** The query is `.limit(500)`. Those newest 500 rows span 6.7 days and contain **15 of 20** distinct feeds. The 5 absent are exactly the dead ones — `acnc_register` (86d, no success ever), `pfra_members` (82d), `austrac` (31d), `cryptoscamdb`, `threatfox`. Three are _not_ muted and should be alerting. **The harder a feed fails, the more certainly it is invisible.**
- **(c)** `KNOWN_DORMANT_FEEDS` (`route.ts:50-64`, commented "dormant by choice") mutes 12 feeds, of which **7 are actively producing** — `ipsum` 210,643 rows/30d, `phishing_army` 33,374, `openphish` 14,488, `abuseipdb` 6,146, `phishtank` 5,796. **5 of the platform's top 6 volume feeds have no staleness alerting at all.** Effective coverage is 4 live feeds.
- **(d)** Both `health-digest` and `feedback-digest` Telegram sends are gated on `readBoolEnv("FF_LEGACY_DIGEST_TELEGRAM")`, absent from `vercel env ls production` → false → dark. Deliberate and documented in-code (the signal "now rides in the consolidated 7am founder brief"), but the replacement is an out-of-repo Claude Code Routine that nothing in this repo or prod can audit. `cost-daily-check/route.ts:80-84` explicitly routes its invalid-cap diagnostic through this muted digest.

### 2.4 The scraper circuit breaker is a permanent latch

`pipeline/scrapers/common/backoff.py:16-19` promises "after the cooldown expires, the next call probes upstream once." It cannot. `should_backoff()` (:114-127) anchors the 24h cooldown on the **head** row; `enforce_backoff_or_skip()` (:193-206) then writes a **new** backoff partial stamped `now()`. The cron fires every ~1.8h, shorter than the cooldown, so the head row is always <24h old — **the cooldown is re-armed by the very act of skipping.** Release requires >24h of workflow silence, which a 4-tier cron guarantees never happens.

`acsc`: 1,167 lifetime rows, **0 successes ever**, 76 errors (all 2026-05-06→05-10) then **1,091 consecutive** backoff partials through 2026-07-29; inter-row gaps max 7.01h, mean 1.79h, never once near 24h. `phishstats`: 244 rows, 0 successes, 243 consecutive partials. The logged text is the tell: `backoff_active: 0 consecutive failures (threshold=3); skipping for cooldown` — the failure threshold isn't what holds it, the self-renewing cooldown is.

**Two mitigants:** both upstreams would fail today anyway (`cyber.gov.au` blocks GH-Actions/Azure egress, proven 2026-05-11 and documented at `health-digest/route.ts:33-39`; phishstats returned HTTP 522 after 19.6s on 2026-07-30), so live data loss is small. But the latch converts _any_ transient blip into an irreversible silent outage — and `austrac` was de-scheduled on 2026-06-29 for this identical root cause, so the pattern was seen once and not generalised.

**Product-facing consequence:** `feed_items` has **zero `acsc` rows lifetime**, yet `apps/web/components/FeedList.tsx:20` ships an "ACSC" filter. Confirmed live — `GET https://askarthur.au/scam-feed` returns HTML containing "ACSC" on an unflagged marketing route. A user can select it and get an empty list forever.

**Fix:** anchor the cooldown on the **oldest contiguous** backoff row of the current streak, or don't INSERT while already cooling. Add a regression test asserting a probe occurs after `cooldown_hours` when the cron interval is shorter than the cooldown.

### 2.5 `Scrape Vulnerability Feeds` is 16/16 green while 3 of 5 feeds have failed 15/15 runs for 14 weeks

The Python scrapers catch their own exceptions, write `status='error'` to `vulnerability_ingestion_log`, and **exit 0**. So `notify-failure` (`needs: scrape` + `if: failure()`) has never fired and structurally cannot.

`nvd_recent` 15 runs / 15 non-success / 0 fetched / 0 new; `github_advisory` 15/15/0/0; `cert_au_vulns` 15/15/0/0 — all `first_run` 2026-04-21, `last_run` 2026-07-26, a 100% failure rate for their entire existence. Only `cisa_kev` (1,652 new) and `osv_feed` (2,339 new) work. Errors: NVD `404` on `services.nvd.nist.gov/rest/json/cves/2.0`; GHSA `401` on the GraphQL API (and before that `argumentNotAccepted` on `securityAdvisories.ecosystem`); `cert_au` 60s read timeout to `www.cyber.gov.au`. **The secrets exist** (`NVD_API_KEY`, `GHSA_PAT`, both added 2026-04-21) — the calls are made and rejected. No doc anywhere records these three as failing.

**Fix:** make the workflow reflect the log table — an `if: always()` gate that queries this run's rows and exits 1, mirroring `scrape-feeds.yml:241-249`.

### 2.6 `Promptfoo regression eval` is 24/24 green and has never run an eval

`promptfoo.yml:53` reads `secrets.ANTHROPIC_API_KEY_EVAL`; `:55-59` then `exit 0` if empty. That secret — and no `ANTHROPIC_*` secret at all — is among the 16 repo secrets (verified 2026-07-30). Full history: **24 runs, 100% `success`, no other conclusion ever recorded.** The newest run's log (29779081478) reads `ANTHROPIC_API_KEY_EVAL secret not set — skipping eval`. The `if: always()` upload step defaults to warn-on-missing, so it cannot red the run either. USD $0 spent across 24 runs, 86 days.

The path filter targets exactly the highest-risk files — `packages/scam-engine/src/claude.ts` (the prompt) and `packages/types/src/analysis.ts` (`PROMPT_VERSION`). A prompt change that degrades SAFE/SUSPICIOUS/HIGH_RISK classification ships with a green "Promptfoo regression eval" check beside it.

**Repo-wide rule worth adopting: a step whose key-missing path is `exit 0` should be `exit 1`. A control that cannot run has not passed.**

### 2.7 Nothing gates a merge to main

`branches/main/protection` → **404 Branch not protected** (verified 2026-07-30). The active mechanism is ruleset **15256818** (`main`, enforcement=active) with exactly three rules — `deletion`, `non_fast_forward`, `pull_request` with `required_approving_review_count: 0`. **No `required_status_checks` rule.** `bypass_actors: []`, so `--admin` cannot bypass it anyway; every ordinary merge already bypasses CI.

`ci.yml` on `event=push&branch=main`: **540 success / 196 failure / 90 cancelled**, 2026-02-16 → 2026-07-16. The two most recent red-main head commits are squash-merge titles.

**Honest trend:** the 196 are concentrated Feb–Apr; the last 30 days are 187 success / **1** failure, and the last red main push was 2026-07-16. A red `ci.yml` also doesn't mean a broken deploy — Vercel builds independently, so the prod-reaching subset is lint/test-only failures. This is a missing guardrail, not an active fire.

Root `CLAUDE.md` steps 8–9 describe a `Vercel`-check gate and frame `--admin` as a sparingly-used escape hatch. Neither is what is enforced; reword both.

### 2.8 `Deep Investigation Scan` failed 20 consecutive weekly runs and paged nobody

22 runs total — **20 consecutive `schedule/failure` from 2026-03-01 through 2026-07-12**, unbroken, then success on 07-19 and 07-26. Root cause is admitted in the file itself (`deep-investigation.yml:36-42`): `python -m investigation` was invoked from inside `pipeline/investigation/`, so the import failed — _"whois never actually ran."_ Fixed 2026-07-17.

**The alerting gap is the finding.** Unlike both scraper workflows, `deep-investigation.yml` has **no notify job at all** (grep for notify/Slack/Telegram returns zero hits). 20 red runs over 138 days reached no channel and were caught by manual review. **This is the clearest evidence in the repo that a failed workflow run does not reach a human unless the workflow explicitly pages.**

Now-inefficient half: it apt-installs six pentest tools under a 90-minute timeout to process a worklist that is currently **0 rows** (`scam_entities` has 150 rows; `investigation_data IS NOT NULL` = 1; HIGH/CRITICAL = 1). "Success" means the same thing whether it processed 50 entities or none.

### 2.9 The dollar-denominated brake system has never executed once

`SELECT * FROM feature_brakes` → **0 rows**, and `pg_stat_user_tables` shows `n_tup_ins=0, n_tup_upd=0, n_tup_del=0` — never written in the project's lifetime. There is no deleter anywhere in the codebase (upsert-only, no expiry sweep), so 0 rows genuinely means 0 lifetime writes. `cost-brake-config-error` rows: 0. Days where spend exceeded the $2 default: **0** — max single day **$1.14**, lifetime **$21.71 over 89 days = $0.244/day**.

So the **read** side is fine and fails safe. The **write** side — 13 upsert blocks, 895 lines — is entirely unexercised. A schema or column-name error in any of them surfaces for the first time on the day spend actually runs away. Six specific defects are invisible precisely because nothing has ever tripped:

- **Two brakes announce "paused for 24h" on Telegram while nothing reads them.** Exhaustive grep: `charity_check` and `shopfront_clone_watch` appear only as `logCost` tags and in `cost-daily-check` — **zero `isFeatureBraked()` calls, zero `feature_brakes` reads**. All 11 other keys have readers. `packages/charity-check/src/ocr-lanyard.ts:11` states the Claude Vision spend is "Covered by the existing `feature_brakes.charity_check` $5/day cap." It is not. Live exposure is ~$0 (both features are on free tiers with ~1 row each), so this is a latent defect plus a false doc — **but it is the worst shape of failure, because it tells the operator to stand down.**
- **A brake can engage with zero notification.** `route.ts:736-760` returns `if (!aboveThreshold)` **before** the message is built at :765. `SHOPFRONT_CLONE_WATCH_CAP_USD` defaults to **$1** — structurally below the $2 gate, so it can only ever engage silently. Exactly 1 of 13 caps is affected.
- **`charity-check-embed` spend is invisible to its own cap.** `route.ts:212` filters `feature === "charity_check"`; the only spender writes `"charity-check-embed"` (`acnc-charity-backfill-embed.ts:78`). The same file handles this hyphen/underscore split correctly for `news-intel-embed` and `scam-report-embed` (:290, :295) — an inconsistency, not a convention.
- **Three caps use `.find()` instead of `.filter().reduce()`** (`:180`, `:202-203`, `:212`) against a view grouped by `(day, feature, provider)` — counting only the highest-cost provider. `charity-check/route.ts` already logs both `anthropic` (:147) and `composite` (:179), so this is one invocation from being live.
- **Uncovered tags:** `web_analyze` ($0.3198, live), `monthly_intel_blog`, `reddit-intel-weekly-synthesis`, `reddit-intel-classify-retry` ($0.1592 — 6th-largest line, absent from the `reddit_intel` filter at :187-190), `twilio-lookup`/`twilio_lookup`, `themes-retrieval`. ~$1.09 of $21.71 lifetime (~5%). And **`apps/web/lib/mediaAnalysis.ts:135` calls `analyzeWithClaude` with no `logCost` at all** — `/api/media/analyze` Claude spend is entirely invisible.
- **Detection lag is 3h mean / 6h worst** (`0 */6 * * *`, sole writer), and the pause is a flat `now()+24h` regardless of the UTC day boundary the spend was measured against.

Separately, **`isFeatureBraked` fails open twice over** (`cost-log.ts:127-144`): `if (!data) return false` plus a bare `catch { return false; }`. A transient Supabase error during a runaway silently re-enables spending. 15 call sites.

### 2.10 Charity Check ships a live public page whose only two endpoints 503

`GET https://askarthur.au/charity-check` → **HTTP 200**, `x-nextjs-prerender: 1`, body contains "Is This Charity Real" — so `NEXT_PUBLIC_FF_CHARITY_CHECK` is **ON** and `gateOrNotFound` did not fire. But `POST /api/charity-check` and `GET /api/charity-check/autocomplete` both return **503 `{"code":"feature_disabled"}`**. Every search a user runs errors out. Both gates read the same `featureFlags.charityCheck`, so page-live/routes-disabled is an inconsistency in its own right.

### 2.11 The ACNC register is a frozen 89-day snapshot, and delisting detection has never had an input

`docs/ops/charity-check-config.md:73` states `ENABLE_CHARITY_CHECK_INGEST` = **`true`** ("Set 2026-05-02"); :39 says "already done". Root `CLAUDE.md` says "63,637 rows, weekly source / daily scraper". Actual: `gh variable list` → **`false`** (set 2026-05-09), and both `scrape-feeds.yml` steps (:204, :214) require `== 'true'`. Prod: 63,637 rows, `max(ingested_at) = max(updated_at) = 2026-05-02 06:09:16` — **89 days**. The row count matches the docs exactly, which is what makes the claim convincing.

Worse: `last_seen_in_register IS NOT NULL` = **0** and `is_delisted` = **0** across all 63,637 rows. The delisting-detection triple has never received a single input, so **no charity can ever be flagged deregistered** — the highest-consequence failure mode for a charity-legitimacy checker.

### 2.12 The routine brand-notification chain has been inert for 54 days

`CLONE_WATCH_TRIAGED_EVENT` is emitted from exactly **one** place — `app/api/admin/clone-watch/triage/route.ts:292`, a manual admin click. `clone-watch-auto-triage.ts:46` states explicitly it "deliberately does NOT emit" it. Prod: `max(triage_at)` for `tp_confirmed` = 2026-06-06 09:45:14, for `fp` = 2026-06-06 09:45:49 — the only two values that route writes. Every downstream marker stops in the same window: `brand_notification_queued` last written 2026-06-06 (34 rows); `shopfront_clone_notify_brand`/`resend` last **2026-06-01**. Zero rows sit at `approval_status='unbatched'`, so the 09:30 prepare cron returns `no_unbatched_rows` daily.

**In the same 54 days the platform auto-actioned 1,341 alerts and weaponised 58.** Three registered Inngest functions run green and do nothing.

**Fix:** decide which lane owns brand notification now triage is automated — either emit from the auto lanes when they set `tp_actioned`, or repoint onto a state worklist cron, matching how the recheck lane was rebuilt in v224. Do not leave an event-triggered function whose sole emitter is a human action nobody performs.

### 2.13 33 weaponised alerts are permanently unreachable, and F1 can structurally reach 4 of 30 brands

`clone-watch-urlscan-retrieve.ts:273` stamps `weaponised_notified_at` after `inngest.send()`, and that stamp is the _only_ gate. Prod: 58 rows have `weaponised_at`, all 58 stamped — but **33 (2026-06-10 → 07-10) have no `submitted_to->'weaponised_notification'` key at all**, not even `skipped`. The first key appears 2026-07-12: `FF_CLONE_WEAPONISED_ALERT` went on _after_ those events were emitted into a disabled consumer and marked done. The column name asserts a control it does not represent — it means "event emitted", not "brand notified".

**Compounding coverage ceiling:** of 30 distinct weaponised brands, **11 have any `brand_contact_directory` row and only 4 have an emailable channel** (`security_txt`/`fraud_inbox` — the only two `enqueue_clone_alert_notification` accepts; it RAISEs `22023` otherwise). Directory: 106 rows, 42 emailable, 7 with `last_notified_at`. **Zero weaponised brand alerts have ever been sent** — 2 of 58 ever reached the queue; one expired unapproved 2026-07-12, one has been `pending` since 2026-07-24.

**Fix:** reconcile on the **absence of consumer acknowledgement**, not the presence of the dispatch stamp — `weaponised_at IS NOT NULL AND (submitted_to->'weaponised_notification') IS NULL`. **Vary the event id when re-emitting**: the current id is `clone-weaponised-${alertId}-${via}`, so a naive re-emit is silently deduplicated by Inngest and would report success while sending nothing — the same bug class this finding reports. Rename the column `weaponised_emitted_at`. Make directory coverage a headline gauge (4/30), not a per-row skip reason.

### 2.14 `docs/inngest-brakes.md` drifts in **both** directions

76 registered functions (29 engine + 47 app-local, verified by parsing both registry arrays _and_ every `createFunction` block) vs **47** table rows. **29 have no row**; 0 rows are stale. All 29 are app-local — and `apps/web/__tests__/inngestBrakesMatrixDrift.test.ts` imports only `inngestFunctions` from `@askarthur/scam-engine`, so **the guard's exclusion set is exactly the defect set**: the test is green while 38% of the fleet is unrowed. The doc's own named example of the 2026-07-29 miss, `shopfront-clone-haiku-preclassify`, is _still_ absent one day later — and it is the **#2 spender fleet-wide** ($2.4371 / 1,029 calls in 30d) with kill flag, brake check and `logCost` all present.

**The inverse defect is worse.** Two of the four "Outstanding gaps (P1 tickets)" are **false**:

- _"`competitor-intel-extract` — neither. No `logCost()`, no brake check"_: it imports `isRedditIntelBraked` at :32, calls it at :122, tags `logCost` at :172, prod has 18 calls / $0.5163, and `cost-daily-check:190` folds that tag into the `reddit_intel` aggregate. The doc's grep hit the cron wrapper instead of the extractor it calls — the wrapper's own comment (:30) says "checked inside the extractor".
- _"`shop-signal-enrich` — paid calls with no `logCost()`"_: five `logCost` sites (:265, :286, :301, :319, :449), and prod has `shop_signal` + `shop_signal_reviews` rows.

**An engineer working this list would add a duplicate `logCost` to `shop-signal-enrich` — double-counting APIVoid spend in the very telemetry the brake reads.** One query would have caught both: `select feature, count(*) from cost_telemetry group by 1`.

Also: the guard's second assertion is `expect(Array.isArray(stale)).toBe(true)` — true for every possible input; and its first uses `matrix.includes(id)` (substring), so a **prose mention counts as a row**. Both latent today, both exploited in practice by `shopfront-clone-haiku-preclassify`.

### 2.15 The recheck worklist omits the failure-streak cap its three siblings have

`list_clone_alerts_for_recheck` has **no** `urlscan_failure_streak` predicate. All three siblings do — `list_clone_alerts_for_urlscan_rescan`'s own comment says _"so a permanently failing URL stops re-qualifying every day and burning scan budget"_. The recheck lane is, per its own comment, "the dominant urlscan caller".

Of the 1,260-row recheck universe, **227 rows are failing** (streak 1:18, 2:41, ≥3:168), all with `urlscan_evidence = {"error":"rejected","stage":"submit_failed","status":400}` — a permanent HTTP 400, not a transient 429. Observed streaks reach **8**, 2.7× the cap of 3, proving continuous resubmission. 14 days of telemetry: 4 runs/day, 200 rechecked/day, **submit_failed 30–51/day (mean 40.4)**. 227/1,211 = 18.7% matches the observed 20.2% failure rate — near-uniform selection.

A `< 3` gate removes ~30 wasted submissions/day = **~912/month**, ~15% of the 200/day budget; useful throughput rises 160→190/day, recovering **~1.2 days** of weaponisation-detection latency per backlog rotation. A$0 today (urlscan free tier); on a paid plan, ~912 billable submissions/month.

**Why nobody saw it: the telemetry instrument is saturated.** `metadata.pool` reads **exactly 200 on all 56 logged runs across all 14 days** — it is `RECHECK_FETCH_LIMIT`, not a measurement. The true backlog is 1,211 due. Nobody can tell from telemetry whether rotation latency is 6 days or 25.

### 2.16 Three more silent-green feeds, and one module that has never run

- **`phishing_database`: 244 lifetime runs, ALL `success`, `records_fetched=0`.** Direct probe: the configured upstream returns **HTTP 200 with `size_download = 1 byte`** (a bare newline). `raise_for_status()` passes, the parse loop yields nothing, and the status-downgrade guard lives _inside_ the `if urls:` branch, so an empty parse reports success. Also in `KNOWN_DORMANT_FEEDS`. Pure inventory inflation in a "16 threat-feed scrapers" headline.
- **`crtsh`: 29/29 `success`, 31,584 fetched, `records_new = 0`.** Corroborated from `threat_intel_urls`: 1,959 rows carry `crtsh`, `max(first_reported_at)` = 2026-06-05 — **55 days, zero new rows** — while re-fetching the same ~1,089 certificates daily at 13.6 min/run, the workflow's slowest step (284 min/29d). ADR-0016's 2026-07-17 amendment already declares the CT mechanism dead but treats this scraper as the working exception; **the exception has now stopped producing too.**
- **`feodo` 0 new in 82 days** (static 5-entry upstream); **`spamhaus` 14 new/30d** at 3 polls/day. Both muted, so flatness cannot surface.
- **`pipeline/scrapers/cert_au.py` — 13.5 KB, tested, never executed.** No workflow invokes it; `feed_ingestion_log` has **0 rows** for either declared feed name across its full 6,070-row history. `acsc_alerts.py:10` describes it in the present tense as the active CVE-pipeline counterpart, so a reader concludes AU CERT advisories are being ingested.

**One alarm predicate catches all of these plus ACSC and phishstats:** page when a feed logs `status='success'` with `records_fetched=0`, **or** produces 0 new rows for N consecutive days. This is the highest-leverage single check in the report.

### 2.17 Lower-consequence items, stated once

- **`deploy.yml`** — a workflow named "Deploy" whose entire job is `checkout` + `echo`, with a commented-out `# TODO: Add your actual build + deploy steps here`. `total_count = 0` lifetime; deploys are Vercel-Git-driven. **Delete it** — a green-on-no-op "Deploy" is strictly worse than none.
- **Re-enqueue trap (latent).** `enqueue_clone_alert_notification`'s `ON CONFLICT` branch maintains `status` but never touches `approval_status`, while `list_clone_alerts_unbatched_for_prepare` requires `approval_status='unbatched'`. A future routine re-enqueue of a row at expired/rejected silently fails to re-enter the worklist — the v224/PR#715 pattern verbatim. 9 routine rows sit terminal; zero occurrences today because the emitter has been silent since 2026-06-06.
- **Two decoy columns with no writer.** `shopfront_clone_alerts.fetch_status`: **0 of 2,024** rows non-NULL despite `n_tup_upd = 27,111`. `clone_alert_notification_queue.status`: 100% `'pending'` across all 20 rows while the real lifecycle runs on `approval_status` — and the `ON CONFLICT` branch carefully preserves a `'sent'` value nothing writes. Any `DROP COLUMN status` must also drop `idx_clone_alert_notif_queue_pending`.
- **`scam_urls.report_count` counts cron re-observations, not reports.** Unconditional `+1` per feed per run: avg 185.4, median 163, max 8,277 across 414,338 rows, against only 192,440 lifetime INSERTs. Returned to API consumers as `reportCount`. Deflated: the `ORDER BY report_count` is inside the domain-level branch only, ranking ≤20 URLs within one domain, and a real `unique_reporter_count` already exists.
- **`auto-triage`'s auto-confirm half has never fired in 31 daily runs.** The park half is demonstrably live (`max(triage_at)` = 2026-07-29 13:00:25, exactly the cron minute; 4–10 rows/day on 31 of 32 days). The confirm half: `tp_confirmed max(triage_at)` = 2026-06-06, and 0 of 2,024 rows carry its `shadow_summary` stamp. Cause is a state race — of 72 `likely_phishing` alerts, 69 are already `tp_actioned` with a `netcraft` key, because the Netcraft lane moves rows out of `'pending'` before the 13:00 run. **The confidence gate is not the blocker** (458 of 1,555 `is_clone` rows reach ≥0.9), so widen the worklist; do not lower `STRICT_CONFIDENCE`. Also fix the stale docstring claiming `triage_status IS NULL` (impossible; 0 of 2,024 are NULL).
- **`pg-stuck-query-watchdog`'s auto-terminate has been off for the 82 days since the incident that created it.** `PG_WATCHDOG_AUTO_TERMINATE` is absent from prod env, so `route.ts:76-96` has never executed. The header states the intent verbatim: _"for the first deploy we want to observe alerts for a week … Flip … after that."_ It writes **nothing** to the DB on a hit, so "was the observation week clean?" — the stated precondition for arming it — is unanswerable. Independently confirmed via `get_logs`: prod carries a repeating real error the watchdog structurally cannot see — `index row size 3712 exceeds btree version 4 maximum 2704 for index "scam_urls_normalized_url_key"` (×4 in 24h), plus repeated 269s checkpoints.
- **`axiom-fleet-watch` — the only pager for Inngest `fn.error`/runaway `fn.start`/HTTP 5xx, per its own header — can fail blind.** Two silent exits: missing token (`:41-46`) and `buckets === null` (`:63-66`). Neither pages. `AXIOM_QUERY_TOKEN` _is_ set in prod, so the first cannot occur; the second's rate is unverified (Vercel log API 403). Defensible claim: it _can_ fail blind undetectably.
- **`scraper-brake-alert` pages once per activation and never re-asserts.** Reconstructing transitions with `lag()`: 27 total, and **the last pageable transition was 2026-06-28 — 31 days and ~2,976 firings ago.** Meanwhile `phishstats` wrote 21 backoff rows in 7 days with no success in its history, and both it and `acsc` are muted in `health-digest`. Correct for noise control; fatal in combination with the two suppression lists.
- **13 of 20 manual-triggerable crons have neither a throttle nor a cooldown**, against root `CLAUDE.md`'s explicit rule (three carry `singleton: {mode:"skip"}`; 11 have nothing whatsoever). Highest-consequence: `monthly-intel-blog` at **$0.0828/fire** with no guard (N stacked fires = $0.083N and N duplicate Ghost drafts); `shopfront-clone-enforcement-execute` (bounded 50/day but no per-hour bound, so a burst puts all 50 external submissions in one hour); `shopfront-nrd-daily-ingest` (repeated whoisds downloads risk a free-tier IP ban that takes clone-watch Layer 0 offline); and four email senders with no Resend `idempotencyKey` (only `clone-watch-internal-digest` guards, at :298).
- **16 of 76 functions have no `timeouts.finish`** despite ADR-0019 declaring it a fleet convention applied in #552. Worst shape: `phone-footprint-vonage-backfill-pager` — `maxPages = 1000` × 2 `step.run`s = **up to 2,000 step-runs in one invocation** (4% of the monthly cap), `retries: 2`, `concurrency: 1`, no finish timeout, no documented duration. Latent only because `phone_footprint_refresh_queue` has 0 rows lifetime.
- **Two functions exceed ADR-0019's concurrency-3 cap** (`shopfront-clone-notify-brand`, `shopfront-clone-submit-netcraft`, both at 4), both triggered by the same `clone.triaged.v1` event, so a saturated instance leaves 1 of 5 slots against the stated ≥2 reserve for the analyze fan-out. ~21 functions declare no limit at all, so the reserve is unenforced rather than merely violated by 2. All five functions ADR-0019 says it rebalanced 5→3 are indeed at 3 — but the matrix still prints 5 for the three phone-footprint rows.
- **Doc/code cadence drift, 9 confirmed**, all in the safe direction (docs claim more frequent than code runs). The dangerous half: `regulator-alert-push`, `shopfront-clone-poll-netcraft` and `report-onward-auto-report` have **no cron at all** while ADR-0019 presents them as live hourly/3-hourly sweeps. Netcraft polling did survive the cron removal — `shopfront-clone-netcraft-reconcile` shows exactly 30 calls in 30 days — but nothing records the handover. `background-workers.md` also contradicts itself on `feed-items-embed` (:105 hourly, :326 every 4h; code is `0 */4`).
- **`enrich-vulnerability`'s retry can re-spend.** `enrichOne` writes `cost_telemetry` **before** the `au_context` update, both inside one `step.run`, with no explicit `retries` (Inngest default 4). A failed telemetry insert leaves the `alreadyEnriched` guard unarmed, so each retry re-calls paid Haiku — up to 5 calls per CVE, against root `CLAUDE.md`'s rule that a retry must not re-spend. Latent: `vuln_au_enrichment` has 0 rows all-time.

---

## 3. What is wasteful

All figures at the calibrated **US$0.00603/billable-min**. Actions baseline is **US$31.93/mo** (US$28.734 for Jul 2–28 × 30/27).

| Change                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       | Est. monthly saving                                  | Risk                                                                                                                                                                                                                                                                                              | Effort                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Fix 11 tiered `if:` blocks so each step matches only its own cron         | Every tier's condition also accepts every lower-cadence schedule. **1,038 of 3,067 step-min over 29d are literal re-runs (33.8%)** — confirmed twice, from 11,319 GitHub step records **and** from prod `feed_ingestion_log`, agreeing to 0.1%. The header comment at :3-6 asserts a control the conditions defeat                                                                                                             | **US$6.47**                                          | Low — restores the file's own documented design. But the 3h cron alone was dropped 20/232 times (8.6%), so the superset currently masks delivery loss; post-fix cadence is 7.3/day                                                                                                                | 1 h                                          |
| Cut `phishtank` + `phishing_army` no-op upsert churn                      | 25.4M rows re-upserted/month to find 38k new (phishtank 0.044% new, army 0.253%). 987 of 3,067 step-min after dedup. Writes are already batched via `execute_values`, so the cost is ~62k PL/pgSQL invocations/run each doing a no-op `last_seen` touch                                                                                                                                                                        | **US$3.09–4.32** (of US$6.16)                        | Med — needs profiling first; `threat_intel_urls` is hot (chunk ≤5K)                                                                                                                                                                                                                               | 4–6 h                                        |
| Split `pipeline-test` into its own workflow with `paths: ['pipeline/**']` | 475/475 CI runs, 480 billable min/29d. All 212 main-push SHAs resolved and each commit's files queried: **6 touch `pipeline/`** (2.83%). 205 of 480 billed min are per-job round-up                                                                                                                                                                                                                                            | **US$2.90**                                          | Low — no required status check exists to bypass                                                                                                                                                                                                                                                   | 30 min                                       |
| Delete the crt.sh step                                                    | 284 min/29d, `records_new = 0` for 29 days in the log and **55 days** in `threat_intel_urls`. Slowest step in the workflow. Removal precedent at :108-113 and :188-191                                                                                                                                                                                                                                                         | **US$1.77**                                          | None — 0 rows lost because 0 are produced                                                                                                                                                                                                                                                         | 10 min                                       |
| Fix Scamwatch's per-run cost, then re-tier                                | 415 runs / 516 min / **1 new item in 29 days**. `scamwatch_alerts.py:42` `RATE_LIMIT_S = 2.0` × ~23 article detail-page fetches every cycle with no existence check ≈ 46s of pure sleep. **Second bug:** the pagination loop (:200-207) sits _outside_ the 304 else-branch, so despite its comment it re-fetches listing pages every run and the `http_cache` short-circuit never engages                                      | **US$1.34** (cadence) + most of the residual US$1.73 | Low                                                                                                                                                                                                                                                                                               | 1–2 h                                        |
| Collapse 4 crons into 1 with in-job hour dispatch                         | 15 scheduled runs/day where 8 would do; 7 × (13.7s fixed overhead + ~30s round-up)                                                                                                                                                                                                                                                                                                                                             | **US$0.92**                                          | Med — **the naive fix is defective**: on a `0 */3` grid `date -u +%H` never yields 16, so `run_daily` is unreachable and the whole daily tier (ASIC, IPsum, AbuseIPDB, crt.sh, ACNC, PFRA) silently stops while staying green. Move the daily hour onto the grid or keep `0 16` as a second entry | 1 h (do with the dedup fix — same 11 blocks) |
| Re-tier or drop `feodo` / `spamhaus` / `phishing_database`                | feodo 0 new in 82 days; spamhaus 14 new/30d at 3 polls/day; phishing_database upstream is 1 byte. All muted, so flatness cannot surface                                                                                                                                                                                                                                                                                        | **US$0.10**                                          | None                                                                                                                                                                                                                                                                                              | 15 min                                       |
| **— GHA subtotal, config-only —**                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                | **US$13.50**                                         |                                                                                                                                                                                                                                                                                                   | ~4 h                                         |
| **— GHA subtotal, incl. the upsert code change —**                        |                                                                                                                                                                                                                                                                                                                                                                                                                                | **US$16.6–17.8**                                     |                                                                                                                                                                                                                                                                                                   | ~10 h                                        |
| Add a 20h recency guard to `bulk_upsert_feed_url`'s DO UPDATE             | **88.6% of all dirtied blocks (20.4M of 23.0M), 93.9% of all WAL (215 of 229 GB), 83.8% of all exec time.** `scam_urls`: `n_tup_ins` 192,440 vs `n_tup_upd` 75,737,231 = 99.75% updates; 99.79% of 7d URL updates are rewrites; 241,186 distinct URLs × 4.31 rewrites/day. A 20h guard cuts 798,899/day (76.8%) ≈ **55 GB WAL/mo** + 4.3 h DB CPU/quarter                                                                      | **US$0 cash** — Supabase Pro is fixed at $25         | Med — `RETURNING`/`xmax=0` is_new detection needs adjusting (treat no-row as unchanged); changes `report_count` semantics                                                                                                                                                                         | 3 h + migration                              |
| Drop `idx_scam_urls_last_reported` + 2 zero-scan indexes                  | 406 MB btree with **idx_scan = 3 lifetime** = 74% of the index footprint, maintained on every one of 75.7M updates. Only **0.431%** of updates are HOT. Heap 164 MB vs indexes 546 MB = 3.33:1 — breaches root `CLAUDE.md`'s own >100 MB / >5:1 hot-table rule. Plus `idx_scam_urls_feed_reported_at` (8 MB) and `idx_scam_urls_feed_sources` GIN (3.5 MB), both `idx_scan` **0**                                              | **US$0 cash**, 418 MB disk                           | Low — grep `order by last_reported_at` first. HOT only actually returns once the recency guard lands                                                                                                                                                                                              | 30 min + migration                           |
| Add `urlscan_failure_streak < 3` to the recheck worklist                  | ~912 wasted submissions/mo, 15% of the 200/day budget, ~1.2 days of detection latency                                                                                                                                                                                                                                                                                                                                          | **US$0** (free tier)                                 | Low                                                                                                                                                                                                                                                                                               | 1 h + migration                              |
| Park dead crons; inline the NRD fan-out                                   | `acnc-charity-backfill-embed`: 63,637 of 63,637 embedded, zero work for 89 days, 30 runs/mo — _and its producer register is frozen, which is the real finding_. Enforcement chain: `shopfront_takedown_attempts` has **0 live rows** (2 lifetime inserts) while 58 weaponised events flowed past; ~274 flag-dark early-return runs/mo. NRD fan-out sends 50 single-item events → 4 step-runs each ≈ 4,116/mo vs ~1,120 inlined | **US$0**, ~3,000 step-runs/mo (6% of the 50k cap)    | Low. The counter-argument for the fan-out is real (per-item idempotency + retry isolation) — if kept, add a `throttle` so a widened `p_limit` can't multiply 4×                                                                                                                                   | 2 h                                          |
| **— Non-GHA total —**                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                | **US$0.00 cash**                                     |                                                                                                                                                                                                                                                                                                   |                                              |
| **— TOTAL CASH SAVING —**                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                | **US$13.50 config-only / US$16.6–17.8 with code**    |                                                                                                                                                                                                                                                                                                   |                                              |

### Verdict on the "$15–25/mo" estimate in the residency plan

**It holds at the bottom of the range and not at the top — and every dollar of it is in the GHA lane.**

- **Config-only, zero coverage loss relative to the workflow's stated design: US$13.50/mo** (42% of the bill) — just below the stated floor.
- **Adding the phishtank/army upsert work: US$16.6–17.8/mo** (52–56%) — inside the range, but that half needs profiling and a hot-table migration, so it is **not** "no migration risk" as the residency plan's §7 describes it.
- **US$25/mo is not reachable.** That is 78% of a US$31.93 bill whose irreducible floor is ~US$16–19/mo — CI at ~1,115 billable min/mo after the paths filter, plus the genuinely high-yield feeds (`ipsum` at 0.0008 min per new row, `openphish` 0.0008, `abuseipdb` 0.0026, `urlhaus` 0.019), plus per-job round-up. Reaching US$25 means cutting feed coverage, not waste.
- **Non-GHA savings are US$0.00 in cash.** Supabase Pro is fixed at $25/mo; urlscan and whoisds are free tiers. The DB work is worth doing anyway — 88.6% of dirty-page IO is avoidable rewriting, and IO exhaustion is what took the site down on 2026-05-09 — but it must not be sold as a bill reduction.
- **One hedge that could vindicate the top of the range.** The calibrated US$0.00603/min is 25% below list and we could not determine why (plan discount vs an included-minutes allowance pro-rated into the daily `netAmount`). **If it is an allowance, the marginal minute costs US$0.008 and every figure above is 33% larger** → config-only US$18.0, with-code US$22–24. One look at the GitHub billing UI settles it.

---

## 4. Ordered work plan

Ordered by consequence ÷ effort, respecting real dependencies. **§1 first, today.**

**PR1 — Turn on the DR backup and make its silence audible.** R2 bucket + 4 secrets + `ENABLE_DR_DUMP` (all out-of-repo); new `.github/workflows/dr-watchdog.yml`; `docs/ops/dr-plan.md`; `docs/ops/pending-manual-setup.md`. Also record the observed PITR state — open Supabase → Database → Backups and replace `dr-plan.md:34`'s bare assertion with `verified <date>: PITR enabled, <N>-day window`. Fix `:17` and `:128`, which say Sydney while `get_project` returns `ap-southeast-1` (Singapore). Add PITR re-verification to the quarterly drill checklist at :77-87. **Verify:** `gh run list --workflow dr-pg-dump.yml --limit 3 --json conclusion` → `success`, not `skipped`; the "Verify upload" step passes; the watchdog pages when pointed at a stale prefix. **Rollback:** `gh variable set ENABLE_DR_DUMP --body false`. **Deps:** none. **~3 h + the overdue drill.**

**PR2 — `alert_delivery_log` + a sender that reports its outcome.** ⭐ _the gate's foundation._ `sendAdminMessage.ts` (return `{ok, reason?}`); all 8 cron routes; new migration `alert_delivery_log(id, alerter, fired_at, condition_met, channel, outcome check in ('sent','skipped_no_config','failed','muted'), error, latency_ms, payload_digest)`. Every alerter writes **exactly one row per firing, including the no-issue case**, so a _missing_ row means the cron did not run rather than that nothing was wrong. Wrap each cron in `getLogger({source:'api/cron', fnId})` and use `.warn` (always-ship) for fired/failed so the record outlives Vercel's ~1-day retention. **Verify:** the §5 Check 2 query returns a row for all 8 within 2× cadence. **Rollback:** the table is additive; revert the sender signature (callers ignore the return by default). **Deps:** none. **~4 h.** _This is residency-plan step 5._

**PR3 — Make `health-digest` capable of seeing a dead feed.** `health-digest/route.ts`; new migration (`latest_feed_run` view or `DISTINCT ON` RPC). Four changes: `DISTINCT ON (feed_name)` over an explicit roster instead of `.limit(500)`; staleness from the last **success**, not the last row of any status; a feed with zero rows in the window reports `hours_stale = ∞`, not absent; delete `KNOWN_DORMANT_FEEDS` and drive dormancy from `feed_sources.enabled` so "dormant by choice" is data an operator can see and change. Retire `austrac`, `threatfox`, `cryptoscamdb` as `enabled=false`. Set `FF_LEGACY_DIGEST_TELEGRAM=true`, **or** have the founder-brief routine write an `alert_delivery_log` row with `channel='founder_brief'`.

Ship the one high-leverage predicate here: **page when a feed logs `status='success'` with `records_fetched=0`, or produces 0 new rows for N consecutive days.** This single check catches `crtsh`, `phishing_database`, `feodo`, `acsc` and `phishstats` — every silent-green feed in this report.

**Verify:**

```sql
select feed_name,
       max(created_at) filter (where status='success' and coalesce(records_new,0)>0) as last_useful,
       now() - max(created_at) filter (where status='success' and coalesce(records_new,0)>0) as stale_for
from feed_ingestion_log group by 1 order by 2 nulls first;
```

Expect `acnc_register`, `pfra_members`, `acsc`, `phishstats`, `phishing_database`, `crtsh`, `feodo` as stale/never, and the next digest to name them. **Deps:** PR2. **~3 h.**

**PR4 — Un-latch the circuit breaker.** `pipeline/scrapers/common/backoff.py`; tests; `docs/system-map/background-workers.md`. Anchor the cooldown on the **oldest contiguous** backoff row of the current streak, or skip the INSERT while cooling. Add a regression test: with a cron interval shorter than `cooldown_hours`, a probe **must** occur after `cooldown_hours` elapse. Then `gh workflow run scrape-feeds.yml -f feed=probe_acsc` to settle runner-IP reachability once and for all; if it fails, disable ACSC explicitly the way AUSTRAC was (`scrape-feeds.yml:160-172`) and remove the dead `acsc` option from `FeedList.tsx:20` and the four `api/v1` source-label maps. **Verify:** `select feed_name, status, error_message, created_at from feed_ingestion_log where feed_name in ('acsc','phishstats') order by created_at desc limit 10;` — expect a real error or success, not a 1,092nd `backoff_active`. **Deps:** none. **~3 h.**

**PR5 — Fix the promptfoo eval.** ⭐ `promptfoo.yml`; the `ANTHROPIC_API_KEY_EVAL` secret. Add the secret; change `:55-59` from `exit 0` to `exit 1` with an `::error::`. Add `if-no-files-found: error` to the upload step. **Verify:** a genuine pass, then push a deliberate prompt regression to a scratch branch and confirm the check goes **red** — a control that has never failed has never been tested. **Deps:** none. **~2 h.** _This is residency-plan step 6, exactly as scoped._

**PR6 — Require status checks on main** _(ruleset config)._ Add a `required_status_checks` rule to ruleset 15256818: `Lint • Typecheck • Test • Build`, `Python scraper tests`, the Vercel preview check, and — once PR5 lands — `Promptfoo regression eval`. Enable `strict_required_status_checks_policy`; this also preserves the Turbo remote-cache behaviour ship-step 4 relies on. Reword root `CLAUDE.md` steps 8–9 to describe what is enforced and drop the `--admin` guidance (it cannot bypass this ruleset). Decide the `claude-code-review` label flow: document "add the `claude-review` label before merging" as an explicit step, or delete the workflow so its permanently-skipped check stops implying coverage. **Verify:** `gh api …/rulesets/15256818 --jq '.rules[].type'` includes `required_status_checks`; open a scratch PR with a deliberate lint error and confirm merge is blocked. **Deps:** PR5 and PR10 first, or a currently-red check becomes a hard block. **~1 h.**

**PR7 — Prove the brake write path with a canary drill.** ⭐ `cost-daily-check/route.ts`; `charity-check/route.ts`; `shopfront-nrd-daily-ingest.ts`; `ocr-lanyard.ts`; `mediaAnalysis.ts`; new `app/api/admin/cost-brake-drill/route.ts`; new invariant tests. Seven changes: (a) the drill route (see §5 Check 3b); (b) add the two missing readers — `isFeatureBraked("charity_check")` before `ocrLanyard()`, `isFeatureBraked("shopfront_clone_watch")` at NRD handler entry — and fix `ocr-lanyard.ts:11`'s false claim; (c) send Telegram whenever `aboveThreshold || anyBrakeSet`, because a brake firing is always news; (d) replace the three `.find()` calls with `.filter().reduce()`; (e) fold `charity-check-embed` and `reddit-intel-classify-retry` into their cap aggregates; (f) add `logCost` to `mediaAnalysis.ts:135`; (g) set `paused_until = tomorrow 00:05 UTC`, not `now()+24h`.

**Two CI invariant tests — this is the durable half:** every brake key written by `cost-daily-check` has ≥1 `isFeatureBraked`/`feature_brakes` reader; every distinct `feature` in `cost_telemetry` maps to exactly one cap aggregate. **Deps:** PR2. **~5 h.**

**PR8 — The GHA cost fix, one PR.** `scrape-feeds.yml` (11 `if:` blocks + cron consolidation + delete crt.sh + re-tier feodo/spamhaus/phishing_database); new `pipeline-test.yml`; `ci.yml`; `scamwatch_alerts.py`; delete `deploy.yml`; `docs/adr/0016-*.md`. **Watch the two traps:** on a `0 */3` grid `$h` never equals 16 — keep `0 16` as a second schedule entry or move the daily hour onto the grid, or the entire daily tier silently stops. And do **not** add a concurrency group to `scrape-feeds.yml`: only 64 of 414 consecutive run pairs overlap and each overlap is a different tier doing different work, so `cancel-in-progress` would kill legitimate runs. **Verify:** after 7 days, `select feed_name, count(*)/7.0 as runs_per_day from feed_ingestion_log where created_at > now() - interval '7 days' group by 1 order by 2 desc;` → `scamwatch_alert` and `acsc` drop from ~14.7 to ~8, `crtsh` absent. Then check `infra_cost_daily` for ~US$0.20/day lower. **Deps:** PR4 (probe ACSC before changing its tier). **~4 h.**

**PR9 — Stop rewriting 800k unchanged rows a day** _(the biggest non-cash win)._ New migration recreating all 4 `bulk_upsert_feed_url` overloads + `DROP INDEX` ×3; `pipeline/scrapers/common/db.py`; `app/api/scam-urls/lookup/route.ts`. Add `WHERE scam_urls.last_seen_in_feed < NOW() - INTERVAL '20 hours' OR NOT (p_feed_source = ANY(scam_urls.feed_sources))` to the DO UPDATE. Treat "no row returned" as unchanged and count it in `records_skipped`. Drop `idx_scam_urls_last_reported` (406 MB, 3 scans) + the two zero-scan indexes. Stop incrementing `report_count` for re-observations; rank the lookup endpoint on `array_length(feed_sources,1) DESC, last_seen_in_feed DESC`. **Grep `order by last_reported_at` across `apps/` before the DROP.** **Verify:** 48h post-deploy, `bulk_upsert_feed_url`'s share of `shared_blks_dirtied` should fall from 88.6% toward ~25%, and `n_tup_hot_upd / n_tup_upd` on `scam_urls` should rise well above 0.431%. Then `get_advisors` per the repo's hot-table rule. **Deps:** none, but ship the `report_count` change _with_ the guard — the guard changes that number's meaning. **~4 h.**

**PR10 — Make the vuln workflow tell the truth, then fix its feeds.** `scrape-vulnerabilities.yml`; `nvd_recent.py`, `github_advisory.py`, `cert_au_vulns.py`; `deep-investigation.yml`; `cert_au.py` (wire up or delete + fix `acsc_alerts.py:10`). Add an `if: always()` gate that queries this run's `vulnerability_ingestion_log` rows for `status<>'success'` and exits 1 — `notify-failure` then works as designed. Point NVD at the current 2.0 endpoint; rotate `GHSA_PAT` with `read:security_events` and fix the rejected `securityAdvisories(ecosystem:)` argument; disable `cert_au_vulns` explicitly if `cyber.gov.au` blocks runner IPs. Add a **Telegram** notify-failure job to `deep-investigation.yml` (not Slack) and report entities-investigated into `$GITHUB_STEP_SUMMARY`. **Verify:** all five feeds with `ok > 0` in a 14-day window, and `gh run list --workflow scrape-vulnerabilities.yml` must be _able_ to go red. **Deps:** must land before PR6 if these join the required set. **~4 h.**

**PR11 — Stop resubmitting 168 permanently-rejected URLs.** New migration recreating `list_clone_alerts_for_recheck` with `p_max_failure_streak integer DEFAULT 3`; `clone-watch-lifecycle-recheck.ts` (log `metadata.due` alongside `metadata.pool`); new `count_clone_alerts_due_for_recheck` RPC. Record terminal 400s as `stage='submit_rejected'` and exclude on that, not on a counter that keeps climbing. **Verify:** over 7 days, `submit_failed` falls from ~40/day to ~10/day and `due` becomes a real number (currently `pool` is pinned at 200). **Deps:** none. **~2 h.**

**PR12 — Reconnect brand notification and re-emit the 33 stranded alerts.** `clone-watch-notify-brand.ts`; `clone-watch-urlscan-retrieve.ts`; `clone-watch-auto-triage.ts`; new migration (rename `weaponised_notified_at` → `weaponised_emitted_at`; fix `enqueue_clone_alert_notification`'s `ON CONFLICT` to move `approval_status` back across the read predicate and NULL `batch_id`/`prepared_at`/`email_*`; widen the auto-confirm worklist to `triage_status NOT IN ('fp','tp_confirmed')`). Add a reconcile sweep predicated on the **absence of consumer acknowledgement** and run it once over the 33. **Vary the event id** or Inngest dedupes them silently. Feed the 26 uncovered brands into `known-brands-discover` as a `weaponised_at`-keyed worklist, and emit a daily coverage gauge (currently 4/30). Page when a staged alert expires unapproved. **Verify:** `select count(*) from shopfront_clone_alerts where weaponised_at is not null and (submitted_to->'weaponised_notification') is null;` → 0; `select approval_status, count(*) from clone_alert_notification_queue group by 1;` → non-zero `sent`. **Rollback:** the column rename is the risky part — ship it as `ADD COLUMN` + backfill + view if you want a clean revert. **Deps:** PR2. **~5 h.**

**PR13 — Make the brake matrix enforced rather than asserted.** `docs/inngest-brakes.md`; extract `appFunctions` from `app/api/inngest/route.ts` into `functions/index.ts`; `inngestBrakesMatrixDrift.test.ts`; `docs/adr/0019-*.md`; `background-workers.md`. Add the 29 missing rows, starting with `shopfront-clone-haiku-preclassify` (all-✓ in code, #2 spender). **Delete the two false "P1 gaps"** and correct those cells to Cost ✓ / Brake ✓. Fix the three stale phone-footprint `Conc.` cells (5→3), the 5 wrong `Trigger` cells, and the `feed-items-embed` self-contradiction. Add a dated ADR-0019 amendment recording the three cron removals and the Netcraft-polling handover. Replace `expect(Array.isArray(stale))` with a real assertion; change `matrix.includes(id)` to a row-anchored regex; extend the guard to assert each `Trigger` cell against `fn` config. Add a note that gap claims must be verified against `select feature, count(*) from cost_telemetry group by 1`. **Verify:** delete a row deliberately and confirm the test fails. **Deps:** none. **~4 h.**

**PR14 — Resolve the ACNC contradiction and the live-page/dead-endpoint split.** `scrape-feeds.yml` (or the variable); `docs/ops/charity-check-config.md`; root `CLAUDE.md`; `charity-check/page.tsx` + `api/charity-check/route.ts`. Either set `ENABLE_CHARITY_CHECK_INGEST=true` and confirm `last_seen_in_register` starts populating — **without that column advancing, delisting detection stays inert even after the scraper resumes** — or record the dataset as a frozen 2026-05-02 snapshot with delisting non-operational, in both docs. Separately, make the page gate and the route gate agree. **Verify:** `select count(*) filter (where last_seen_in_register is not null) from acnc_charities;` → non-zero; the autocomplete endpoint not 503 while the page is 200. **Deps:** none. **~2 h.**

**PR15 — Config hygiene sweep** _(batch last)._ Add `timeouts.finish` to the 16 functions without one; drop `phone-footprint-vonage-backfill-pager`'s `maxPages` 1000 → ~200 with cursor re-arm; lower `notify-brand-prepare`'s 10m to 8m; lower the two concurrency-4s to 3 and add `concurrency: 1` to single-run crons; add throttle+cooldown to the 13 unguarded manual-triggerables (prioritise `urlscan-retrieve`, `enforcement-execute`, `monthly-intel-blog`) and a Resend `idempotencyKey` to the four unguarded email senders; park `acnc-charity-backfill-embed` and the two enforcement crons event-only; split `enrichOne` so the paid Claude call and the persistence are separate steps, reorder so `au_context` lands first, set `retries: 2`; delete `threatfox.py`/`cryptoscamdb.py`; make `isFeatureBraked` fail **closed** for paid call sites. **~6 h.**

### Effect on residency-plan steps 7–8

The residency plan §9 gates Bedrock `au.*` (step 7) and the AU report plane (step 8) on step 5 "make alerting auditable + brakes readable" and step 6 "fix the promptfoo eval", with the standing instruction _"Do not start 7 or 8 without 5 and 6 done."_

**This audit WIDENS the gate.** The instinct is fully vindicated; the scope of step 5 as written is too narrow.

**Step 6 is VALIDATED exactly as scoped.** The diagnosis (secret + fail-on-missing) is precisely right. New supporting number: 24/24 green, 100% of them the `exit 0` branch, USD $0 spent, 86 days. The ~2h estimate holds. **PR5, unchanged.**

**Step 5 is VALIDATED in premise but UNDER-SCOPED by roughly 3×.** The plan names three things — `feature_brakes` has zero rows, two brakes are write-only, `sendAdminMessage` returns `void` and swallows. All three confirmed exactly. Six more must land before "alerting is auditable" is true:

1. **No alerter has any delivery record at all** — not just `sendAdminMessage`'s swallowed catch. → PR2.
2. **`health-digest` is structurally incapable of reporting a dead feed**, and printed "all clear" on 2026-07-29 while `acnc_register` was 86 days stale. Most-corroborated finding in the audit. → PR3.
3. **The brake _write_ path has never executed once.** The plan reads "zero rows" as evidence brakes never engaged; it is also evidence the 895 lines that engage them are **untested code**. Fixing the two write-only brakes does not fix this — only a drill does. → PR7.
4. **`axiom-fleet-watch` — the only pager for Inngest failures, by its own header — can fail blind and silently.** Not in the plan. → PR2/PR7.
5. **Two of the eight alerters are dark by an unset flag**, delegating to an out-of-repo routine nothing can audit — and `cost-daily-check`'s invalid-cap diagnostic routes _through_ one of them. → PR3.
6. **Brake evaluation lags real spend by up to 6h, and the biggest Claude paths are in no cap aggregate at all** — `web_analyze` ($0.32, live), `reddit-intel-classify-retry` ($0.16); `/api/analyze` has no dollar cap of any kind; `mediaAnalysis.ts:135` calls Claude with no `logCost` whatsoever. → PR7.

**Why this matters more for Bedrock than for anything else here.** Today's whole platform burns **$0.244/day**, so the guardrail has never had to be fast, correct, or observable. Bedrock changes the unit cost by ~25×: Sonnet at $3/M in + $15/M out means one 10k-in/2k-out call ≈ $0.06, against a measured Haiku working rate of $0.00237/call. As a **bounded illustration, not a forecast** — 1 call/s is ~700× current volume — at 1 call/s sustained that is $216/h, up to **~$1,296 (≈A$1,950) inside a single 6-hour evaluation window**, and only then if the new feature tag was remembered in a hardcoded cap list. The plan's own §8 already says _"Bedrock has no native hard spend cap — so the app-side brake is the real control."_ That control has never run.

**One NEW prerequisite the plan does not have: PR1 (DR).** Step 8 moves a report plane to a new region and its gate is _"Dry-run restore verified; rollback project retained 7 d."_ That gate silently assumes a working backup lane. There is none, and never has been. The plan's own §10 landmine — _"Restore from dump, never replay migrations (6 prod migrations have no file)"_ — makes this load-bearing: **the restore path the migration depends on is exactly the path that has never been exercised.** At A$1.15–1.55/month it is the cheapest item in this report.

**One thing the audit NARROWS.** Step 4 (GHA audit, ~3h, gate "spend drops in `infra_cost_daily`") is now fully specified with measured, twice-corroborated numbers, and its item 1 — the latched `acsc` breaker — has a confirmed root cause and a fix. The 3h estimate is low (~4h for PR8 alone), but the uncertainty is gone. **PR8 can proceed in parallel with PR2/PR3/PR7; it is not on the critical path.**

**Revised gate: 7–8 unblock after PR1, PR2, PR3, PR5, PR7 — plus 14 consecutive green days on §5.** That is ~17 hours against the plan's ~6, and it is the difference between a guardrail and a comment describing one.

---

## 5. The acceptance test for "alerting is auditable"

Five checks. All green for **14 consecutive days** before any new paid surface or region ships.

### Check 1 — Every alerter writes a row for every firing

```sql
select column_name, data_type from information_schema.columns
where table_name = 'alert_delivery_log' order by ordinal_position;
-- Expect: alerter, fired_at, condition_met, channel, outcome, error, latency_ms, payload_digest
```

All 8 alerters write **exactly one row per firing, including the no-issue case**: `cost-daily-check`, `cost-weekly-digest`, `health-digest`, `feedback-digest`, `scraper-brake-alert`, `pg-stuck-query-watchdog`, `clone-lead-digest`, `axiom-fleet-watch`. This is the load-bearing property: **a missing row must mean "the alerter did not run", never "nothing was wrong".** Silence is currently indistinguishable from death, which is how `phishstats` reached 89 days at zero successes.

### Check 2 — Liveness, with expected counts

```sql
select alerter,
       max(fired_at)                                              as last_run,
       max(fired_at) filter (where outcome = 'sent')               as last_delivery,
       count(*) filter (where fired_at > now() - interval '7 days') as runs_7d,
       count(*) filter (where outcome = 'failed'
                          and fired_at > now() - interval '7 days') as failed_7d
from alert_delivery_log group by 1 order by 2 nulls first;
```

**Pass:** a row for all 8; `last_run` inside 2× that alerter's cadence; `runs_7d` within 10% of expected — `pg-stuck-query-watchdog` 2016, `axiom-fleet-watch` 672, `scraper-brake-alert` 672, `cost-daily-check` 28, the daily digests 7 each, `cost-weekly-digest` 1; `failed_7d = 0`.

**Fails today** by returning an error, because the table does not exist. That is the honest current state of the gate.

### Check 3 — Two synthetic canaries that force a real send and a real brake

**3a — delivery canary.** `POST /api/admin/alert-canary?alerter=<name>` forces one real send per alerter and asserts `outcome='sent'`. Run for all 8. This is the only thing that distinguishes "`TELEGRAM_ADMIN_CHAT_ID` is set" from "a message actually arrived" — a distinction nothing in prod or the repo can currently make.

**3b — brake drill.** `POST /api/admin/cost-brake-drill`, asserting in order:

1. insert `cost_telemetry` row `feature='__canary'`, `$0.02`, against a `$0.01` canary cap;
2. invoke `/api/cron/cost-daily-check`;
3. `select * from feature_brakes where feature='__canary'` returns exactly 1 row with `set_by='cost-daily-check'`, `set_cost_usd≈0.02`, `set_threshold_usd=0.01`;
4. the Telegram send returned `{ok:true}` — **this must pass while total daily spend is under $2**, which is precisely the silent-engage gap at `route.ts:736-760`;
5. an `alert_delivery_log` row exists with `outcome='sent'`;
6. a consumer gated on that key early-returns;
7. both canary rows are deleted.

Run 3a and 3b **monthly against prod**, and on every PR touching `apps/web/app/api/cron/**` against a Supabase preview branch.

### Check 4 — A meta-alert, so an alerter's own death pages

One hourly `alerter-watchdog` cron runs Check 2 and pages when **any** alerter's `last_run` is older than 2× its cadence, **or** when ≥2 consecutive rows have `outcome IN ('failed','skipped_no_config')`. Two non-negotiable properties:

- **It writes its own `alert_delivery_log` row** (self-referential), so its liveness appears in the same query it runs. Otherwise it is the next `axiom-fleet-watch`: a cron that watches for silent failures while being the archetype of one.
- **It is covered by Check 3a.** An unmonitored monitor is not a control.

Plus a **stuck-brake / stuck-feed re-assertion**, weekly not 15-minutely: one Telegram line per feed still in backoff and per feed whose newest useful row is older than N days, with days-since-last-success. Transition-only paging is correct for noise but leaves no re-assertion — the last pageable transition was **2026-06-28, ~2,976 firings ago**, while two feeds have never once succeeded.

### Check 5 — CI invariants, so the gate cannot silently rot

Three tests that fail the build:

- **(a)** every brake key written by `cost-daily-check` has ≥1 `isFeatureBraked`/`feature_brakes` reader. _(Would have caught `charity_check` and `shopfront_clone_watch` on day one.)_
- **(b)** every distinct `feature` in `cost_telemetry` maps to exactly one cap aggregate. _(Would have caught `charity-check-embed`, `reddit-intel-classify-retry`, `web_analyze`.)_
- **(c)** every paid-provider call site has a `logCost` on the success path. _(Would have caught `mediaAnalysis.ts:135`.)_

Plus the repaired `inngestBrakesMatrixDrift` test covering `appFunctions` with row-anchored matching. _(Would have caught all 29 missing rows.)_

**Exit condition: Checks 1–5 green for 14 consecutive days, with Check 3 run at least once in prod inside that window.** Then, and only then, residency-plan steps 7–8.

---

## 6. What we could not verify

**UNVERIFIED — an operator must look manually.**

- **Supabase PITR retention.** `docs/ops/dr-plan.md:34,40` assert PITR with a 7-day window; `get_project` exposes no backup settings. **Partially resolved:** prod carries signals consistent with PITR being live — `archive_mode = on`, `archive_command = /usr/bin/admin-mgr wal-push %p …` (WAL-G), `wal_level = logical`. Continuous archiving _is_ running, which makes the worst branch ("no verified backup of any kind") much less likely — but the **retention number is unconfirmed**, and with PR1 undone it is the only backup layer that exists. Dashboard → Database → Backups; one minute of work, do it inside PR1.
- **Whether any Telegram message has ever arrived.** Nothing in prod or the repo records a message id. `TELEGRAM_ADMIN_CHAT_ID` _is_ present in prod env, so the `skipped_no_config` path is not live — but "the variable is set" is the strongest statement available. Unverifiable by construction until PR2 + Check 3a.
- **Whether anyone reads the Slack channel.** Delivery works (HTTP 2xx, body `ok`). But 20 consecutive unactioned `deep-investigation` failures over 4.5 months is behavioural evidence that alerts here do not reliably move anyone.
- **Vercel runtime-log retention and per-cron invocation counts.** The runtime-log API returned **403**. Every "N invocations in 24h" figure in the source findings is `vercel.json` cadence × 24h — an inference, not an observation. The claim "`axiom-fleet-watch` fails blind 96×/day" is **not supported**; the defensible claim is that it _can_ fail blind undetectably.
- **`axiom-fleet-watch`'s `buckets === null` rate**, and whether `FF_AXIOM_ENABLED` is `"true"` in prod (the value is encrypted). The structural defect is confirmed from code; the runtime state is not.
- **Why the Actions rate is 25% below list.** Established empirically (US$0.00603/min, stable to ±2.3% daily across 27 days) but not mechanically. Plan discount and an included-minutes allowance pro-rated into the daily `netAmount` both fit. **If it is an allowance, the marginal minute is US$0.008 and every saving in §3 is 33% larger** — moving config-only from US$13.50 to US$18.0. One look at the GitHub billing UI settles it.
- **The achievable share of the phishtank/army fix.** The 0.044%/0.253% new-row rates and the `execute_values` batching are measured; `bulk_upsert_feed_url` was **not** profiled, so the parse-vs-upsert split is an estimate and the 50–70% reduction is unproven. Instrument one run of each before committing to the number.
- **`phishstats` "zero successes ever."** Provable only inside `feed_ingestion_log`'s 90-day retention (oldest surviving row table-wide: 2026-04-30). Safe for `acsc` (scraper shipped 2026-05-06, first log row 2026-05-06T00:31); **not** provable for `phishstats`, which predates the window.
- **`brand_register` is empty (0 rows) despite 493 lifetime inserts and 493 deletes** — and `replace_brand_register`'s empty-batch guard means an OFF cron cannot wipe it. So something did wipe it, and row state alone cannot say what. Deliberately excluded from the findings rather than guessed. Worth a targeted look if `/admin/brand-register` matters.
- **Whether the daily 16:00 superset sweep is intentional.** Costed as redundant because it contradicts the file's own tier comments, but only the author can settle it. If deliberate, the tier-dedup saving drops from US$6.47 to ~US$4.60.
- **The `feature_brakes` write path.** Read-only remit; no write was attempted. That the 13 upserts have never executed is observed; that they _work_ is not.
- **`cyber.gov.au` reachability from runner IPs.** The one probe that ran was from a residential IP (HTTP 200, 0.1s, 3 items) and does **not** refute the documented WAF/egress block. The narrower and stronger point stands: the scraper short-circuits at the backoff gate before issuing any request, so 1,091 runs produced zero evidence either way. `-f feed=probe_acsc` exists to settle it — run it once in PR4.
- **Commit-level attribution.** No git commands were run (read-only, shared-index constraint), so when the superset `if:` conditions were introduced is unknown; earliest evidence in `feed_ingestion_log` is 2026-05-06.

**REFUTED — considered and dismissed, so these are not re-investigated.**

- **"`reddit_watchlist_candidates` has no exit for its primary state."** Row counts reproduce (41 pending, 10 dismissed, 0 promoted) but the causal claim is wrong: a complete promote path exists and is deployed — `promoteCandidate` in `app/admin/brand-candidates/actions.ts:92`, the `promote_watchlist_candidate` and `demote_watchlist_candidate` RPCs both live in prod, and `CandidateActions.tsx` renders a Promote button in the compiled bundle. The finding's own proposed fix ("promotion needs an explicit operator-supplied domain, not a guess") is **implemented verbatim**, including the `legitimate_domains`-is-an-EXCLUSION-list rationale in the docstring. True observation: **no operator has clicked Promote.** Operator inaction on an admin queue, not a missing writer.
- **"`competitor-intel-extract` spends behind a brake it doesn't check."** False — see §2.14. The finding inherited `docs/inngest-brakes.md`'s claim instead of verifying it; **the doc is what is wrong**, in the opposite direction. Same for `shop-signal-enrich`'s "no `logCost`".
- **`env.GHSA_PAT != ''` step gate always-false.** Retracted by its own auditor: step conclusion is `success`, so the step runs and gets a genuine 401.
- **Stale ACNC data exposed to users.** Refuted — both endpoints 503. Replaced by a _different_ live defect (§2.10).
- **crt.sh's 13.6-min job trips `pg-stuck-query-watchdog`.** Refuted — `list_long_running_queries` filters on a single query's `state='active'` runtime, so 676 short upserts over 13.6 min cannot page.
- **`enrich-vulnerabilities-cron` burns 120 runs/month.** Refuted — it is already manual-trigger-only; the `0 */6` value was read out of a _restore-condition comment_. Zero step-runs, zero saving available. (The re-spend ordering defect in the same file survives.)
- **"Claude Pre-Merge Review has never run."** Refuted — full pagination shows **138 skipped, 2 success, 2 failure**; it reviewed two real PRs on 2026-05-02 (install day). "100 consecutive PRs" counted _runs_, not PRs — every push to any open PR emits a skipped run. Correct statement: ran on 2 PRs, skipped every trigger in the 89 days since. An undocumented gate, not a defect.
- **The stranded "Reece" queue row is an `ON CONFLICT` bug.** Refuted — it is `kind='weaponised'`, excluded from the routine RPC's partial-index arbiter and from the prepare worklist by `kind='routine'`. Its real state is `staged_for_approval` that expired unapproved — the four-eyes bottleneck (§2.13), not the re-enqueue trap.
- **Cost brakes read a stale materialized view** (would have been P0). Refuted — `pg_get_viewdef` shows `daily_cost_summary` and `today_cost_total` are plain views over `cost_telemetry`.
- **`parseFloat`/NaN silently disables caps** (the repo's own documented hazard). Refuted — `readNumberEnv` uses `Number()` with trim and a non-negative finite check; 0 `cost-brake-config-error` rows.
- **Fixed per-run CI overhead dominates a many-small-runs pattern.** False here by a factor of ten: checkout + setup-python + pip install is **13.7s/run = US$0.57/mo** total, against US$6.47/mo for duplicated scraper work. The pip cache is verifiably hitting (~86 MB, "Cache restored successfully"). **Do not optimise setup.** Also verified clean: no push/PR double-billing; `cancel-in-progress` works correctly on `ci.yml` (33 of 476 cancelled, US$1.16/mo buying correct supersede semantics); all 1,895 jobs on `ubuntu-latest` with no matrix or large runners; the 90-min timeouts are not cost centres (one 44.7-min `asic_investor` run justifies it); Actions storage is US$0.013/mo; `continue-on-error` appears nowhere; the `clone-watch-linkedin` approval gate is genuinely enforced (`required_reviewers`, `bypass_actors: []`); the clone-watch enricher healthcheck works with its subject healthy.
- **Cron collisions cause concurrent duplicate fetches.** Refuted — only 64 of 414 consecutive run pairs overlap, because GitHub's **median 114-minute dispatch delay** (p90 175, max 259; 90.4% of runs start >60 min late) scatters collided runs apart. The waste is duplicated minutes, not concurrent hammering. \*Side consequence worth acting on: the four-tier "latency-sensitive" design is swamped by that jitter, and `clone-watch-enricher-healthcheck.yml:40`'s comment "~17 min after the 13:30 enricher tick" is wrong by 68–152 minutes on all 13 runs. **Any runbook step saying "runs at HH:MM" is off by one to four hours.\***
