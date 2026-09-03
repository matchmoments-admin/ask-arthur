# Infrastructure, residency & cost strategy — plan + handoff

**Created:** 2026-07-30
**Supersedes/extends:** `docs/plans/data-residency-remediation.md` (Track A/B/C framing)
**Status:** plan awaiting decision. Nothing in here is implemented.
**Handoff:** written to be picked up cold by a new context. Every number is measured, with the query or command that produced it.

---

## 0. The one-paragraph answer

**Do not migrate to AWS.** Current total run-rate is **~$92/month** and the constraint on this business is demand (2 registered users, 124 checks in 5.5 months), not infrastructure cost. But three narrower moves are genuinely worth doing, and one of them is close to free: move Vercel compute to Sydney (**~1 hour**, removes ~800 ms from every dynamic request), switch Claude to **Bedrock `au.*`** so AI processing is Australia-only, and — the important structural insight — realise that **only 4 MB of the 2,390 MB database is personal data**. Multi-country residency therefore costs ~$25/country and moves megabytes, not gigabytes. The expensive-sounding requirement is the cheap one.

---

## 1. Measured baseline — actual costs, not estimates

From `infra_cost_daily` (the platform's own billing ingest):

```sql
select provider, count(*) days, round(sum(usd_cents)/100.0,2) total_usd,
       round(avg(usd_cents)/100.0,4) avg_daily_usd, min(date), max(date)
from infra_cost_daily group by provider order by total_usd desc;
```

| Provider             | Avg/day          | **Monthly**     | Window     |
| -------------------- | ---------------- | --------------- | ---------- |
| Vercel               | $0.9935          | **$30.20**      | 72 days    |
| GitHub Actions       | $0.9468          | **$28.78**      | 62 days    |
| Anthropic            | $0.2518          | **$7.65**       | 72 days    |
| Supabase Pro         | — (not ingested) | **$25.00**      | flat       |
| Upstash / Cloudflare | —                | **~$0**         | free tiers |
|                      |                  | **≈ $91.63/mo** |            |

Cross-check from `cost_telemetry` (per-call AI/API spend): July $8.38 across 7,778 calls; June $7.16 / 2,023; May $6.17 / 705.

**Two things jump out:**

1. **GitHub Actions is 31% of spend — nearly as much as Vercel** — and it is just the 16 Python scrapers plus CI. This is the single cheapest saving available and it has nothing to do with any migration. See §7.
2. **AI is only 8% of spend.** The instinct that AI is the expensive part is wrong here. Compute and CI dominate.

### Scale reality (needed to size anything honestly)

| Metric                 | Value                                            |
| ---------------------- | ------------------------------------------------ |
| Total checks, lifetime | 124 (5.5 months, ~0.75/day)                      |
| Registered users       | 2                                                |
| Organizations          | 1 (the founder's own)                            |
| `scam_reports`         | 81                                               |
| `onward_report_log`    | 0 until 2026-07-29 (PR #874 fixed the dead path) |
| Threat corpus          | 413K `scam_urls`, 723K `scam_ips`, 63K charities |

The supply side is real and differentiated. The demand side is not there yet. Every decision below is sized for that truth, not for a hoped-for one.

---

## 2. THE KEY INSIGHT — the database is 99.8% non-personal

This is the finding that makes the whole plan cheap. Measured by classifying every `public` table into "personal/jurisdictional" vs "shared threat corpus":

| Plane                                                       | Tables | Size         | % of DB   | Rows      |
| ----------------------------------------------------------- | ------ | ------------ | --------- | --------- |
| **Personal / jurisdictional** (must be in-country)          | 28     | **3,984 kB** | **0.2%**  | 785       |
| **Threat corpus / shared** (non-personal, can stay central) | 128    | **2,365 MB** | **99.8%** | 1,251,342 |

Personal plane = `scam_reports` (+archive, +partitions), `onward_report_log`, `verdict_feedback`, `scam_entities`, `report_entity_links`, `leads`, `email_subscribers`, `user_profiles`, `organizations`, `analytics_events`, `visitors`, `shop_checks`, `image_check_records`, `phone_footprints`, `device_push_tokens`, and the brand-stewardship/reply tables.

Shared plane = `scam_urls`, `scam_ips`, `acnc_charities` + embeddings, `feed_items`, `reddit_post_intel`, `shopfront_clone_alerts`, `known_brands`, and the rest of the intel machinery. This is aggregated, largely public threat intelligence. It is **not** personal information under the Privacy Act, so it carries no residency obligation.

**Consequences:**

- Per-country residency means replicating a **4 MB** schema, not a 2.4 GB database.
- A per-country Supabase project is ~$25/mo and its data will stay in the low megabytes for a long time.
- The 2.4 GB corpus moves **once at most** (for latency), and never needs to be duplicated per jurisdiction.
- Any plan that assumed "we must move 2.4 GB into every country" was solving a problem that does not exist.

---

## 3. Decision A — Vercel compute → Sydney (`syd1`)

**Do this first. It is close to free and independently justified by latency alone.**

| Fact                    | Value                                             | How verified                                                     |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Plan                    | **Pro**                                           | Vercel API `/v2/teams/{id}` → `billing.plan`                     |
| `regions` key today     | **absent** → defaults `iad1`                      | `apps/web/vercel.json`                                           |
| Region selection gated? | No — only `functionFailoverRegions` is Enterprise | Vercel docs                                                      |
| Code assuming a region? | **None**                                          | grep `iad1` / `us-east` / `VERCEL_REGION ===` → only doc strings |
| Current compute region  | `iad1` (US East)                                  | `x-vercel-id: syd1::iad1::…`, 4/4 samples                        |

**Change:** add `"regions": ["syd1"]` to `apps/web/vercel.json`.

**Measured latency today, from Sydney:**

| Request                                                   | TTFB             |
| --------------------------------------------------------- | ---------------- |
| Dynamic (`/api/stats`): Sydney edge → iad1 → Singapore DB | **660–1,214 ms** |
| Edge-cached (`/`)                                         | **111–124 ms**   |
| TCP connect to edge                                       | 15–37 ms         |

Roughly a second per dynamic request is pure geography — a trans-Pacific hop to US compute, then another to the Singapore DB. Moving to `syd1` removes the first entirely and cuts the second from ~235 ms to ~95 ms RTT.

**Trade-off, stated honestly:** the Claude call becomes trans-Pacific, +~200 ms _once_ per analyse, against a multi-second call inside a 15 s/25 s timeout and 60 s `maxDuration`. Noise. (And Decision C removes it.)

**Also affects:** all 20 Vercel crons move region and get faster DB access. No config change needed for them.

**Rollback:** delete the key, redeploy. Seconds.

**Verification gate:** `x-vercel-id` must read `syd1::syd1::…`; re-measure TTFB; smoke-test the crons.

---

## 4. Decision B — Bedrock `au.*` for Australian AI processing

**Feasible, token-cost-neutral, and the only route to a true sovereignty claim.**

### ⚠️ The trap that would have silently broken this

Bedrock inference profiles are not all region-safe:

| Profile prefix | Routes to                                                     | Sovereignty                                           |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `apac.*`       | Tokyo, Seoul, Osaka, Mumbai, Hyderabad, **or** Singapore      | ❌ leaves Australia, and you do **not** control which |
| **`au.*`**     | `ap-southeast-2` (Sydney) + `ap-southeast-4` (Melbourne) only | ✅ Australia-only                                     |
| `global.*`     | all commercial regions                                        | ❌                                                    |

Using `apac.*` would look like a Sydney deployment while shipping prompts to Mumbai. **Must use `au.*`, or invoke the in-region model ID directly with no profile.** AWS also notes prompts/outputs may be stored in destination regions for abuse detection — so the profile choice is a data-residency decision, not a performance one.

### Cost

Bedrock Claude pricing matches the direct Anthropic API — **Haiku 4.5 at $1 / $5 per million tokens**. At $7.65/mo of Anthropic spend, this is cost-neutral. Sonnet 4.6 is $3/$15 if a tier change is ever wanted.

### Work involved

- Swap `new Anthropic()` (`packages/scam-engine/src/claude.ts:395`) for `@anthropic-ai/bedrock-sdk`.
- AWS credentials via IAM role; remap model IDs (Bedrock IDs differ from Anthropic's).
- **Gate:** confirm Haiku 4.5 is available in `ap-southeast-2` with an `au.*` or in-region profile _in the console_ before committing. Model availability by region shifts; do not take a doc page's word for it.
- **Hard prerequisite:** the promptfoo regression eval **has never executed** — no `ANTHROPIC_API_KEY_EVAL` secret exists and `promptfoo.yml:58` does `exit 0` without it, so every run reports green. Swapping the inference backend without a working eval is changing the product's core judgement with no safety net. **Fix the eval first.**
- Known upstream wrinkle: `claude-agent-sdk` has an open issue rejecting `au.*` profile IDs. Not expected to affect `@anthropic-ai/bedrock-sdk`, but verify.

---

## 5. Decision C — database region, and the per-country architecture

### 5.1 Supabase cannot change region in place

Confirmed: create a new project in the target region and migrate. Supabase publishes a "Migrating within Supabase" guide. Region is fixed at provision time.

### 5.2 Migration surface (measured)

| Item                       | Count                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Total size                 | 2,390 MB                                                                                                   |
| Tables / functions / views | 159 / 177 / 20                                                                                             |
| RLS policies / triggers    | 148 / 16                                                                                                   |
| Extensions                 | 8: `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `pgmq`, `plpgsql`, `supabase_vault`, `uuid-ossp`, `vector` |
| **Vault secrets**          | **0** ← the one non-portable thing, and it is empty                                                        |

All eight extensions exist in every Supabase region. Vault being empty removes the hardest blocker.

**Restore from a dump, NOT by replaying migrations.** The prod ledger has 223 rows against 259 files, and six migrations are live in prod with no file at all (v123–v126, v242, v247). A schema replay would silently lose those objects.

### 5.3 The recommended target architecture

```
                    ┌──────────────────────────────────────┐
                    │  CONTROL PLANE  (one, central)       │
                    │  2,365 MB — non-personal             │
                    │  scam_urls, scam_ips, feed_items,    │
                    │  acnc_charities, clone alerts,       │
                    │  known_brands, feature_brakes        │
                    │  → region chosen for LATENCY only    │
                    └──────────────────────────────────────┘
                                    ▲ read
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│ AU  ap-se-2   │          │ NZ / UK / US  │          │  …per market  │
│ REPORT PLANE  │          │ REPORT PLANE  │          │ REPORT PLANE  │
│ ~4 MB         │          │ ~4 MB         │          │ ~4 MB         │
│ scam_reports  │          │ (same schema) │          │ (same schema) │
│ onward_log    │          │               │          │               │
│ verdict_fb    │          │               │          │               │
│ users, orgs   │          │               │          │               │
│ $25/mo        │          │ $25/mo        │          │ $25/mo        │
└───────────────┘          └───────────────┘          └───────────────┘
   + Bedrock au.*             + Bedrock eu.*/us.*        + regional Bedrock
```

**Why this is the right shape:**

- It matches the legal obligation precisely: personal data and police/government reports stay in-jurisdiction; aggregated threat intel is shared, which is exactly what makes the product valuable across borders.
- It matches the product: onward reporting is _inherently_ jurisdictional (Scamwatch/ReportCyber for AU; Action Fraud for UK; FTC/IC3 for US). The routing brain (`get_onward_destinations`) already keys off jurisdiction.
- It scales linearly at ~$25/country — trivial against any revenue that justifies entering a country.
- It composes with Bedrock: `au.*` for AU, `eu.*` for UK/EU, `us.*` for US. Each market's AI processing stays in-market.
- It is honest and provable: you can state "your report never leaves Australia" and have it survive audit.

**Sequencing:** stand up the **AU report plane first** (that is the current market and the police-pilot requirement). Leave the control plane in Singapore initially — it holds no personal data, so there is no compliance reason to move it, only a latency one. Move it later if measurement justifies it.

### 5.4 Minimum-downtime approach

At 0.75 checks/day with 2 users, **engineering for zero downtime is not warranted.** A 1-hour window at ~03:00 AEST costs approximately nothing. Recommended:

1. Provision the new project (Supabase Management API).
2. Dry-run `pg_dump`/`pg_restore` into it; verify counts, functions, policies, extensions; run `rpcs.smoke.test.ts` against it.
3. On the night: put the app in read-only/maintenance, final incremental dump of the report-plane tables (4 MB — seconds), restore, flip env vars, redeploy, smoke-test, exit maintenance.
4. Keep the old project live and read-only for 7 days as rollback.

If true zero-downtime is ever required, native logical replication + cutover is the path — but it is materially more complex and should be deferred until traffic justifies it.

**Programmatic:** Supabase Management API for project creation and secrets; `supabase` CLI for schema/data; `vercel env add/rm` for the ~7 env vars per environment; `gh secret set` for Actions. All scriptable — write it as an idempotent, re-runnable script with a `--dry-run` flag, not a runbook of manual clicks.

---

## 6. Decision D — should you move everything to AWS? **No.**

### Cost comparison at current scale

| Component      | Today                                                                                                | AWS equivalent                                                                                                       | Verdict                           |
| -------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Compute        | Vercel Pro $30/mo (incl. usage)                                                                      | Lambda + API GW: ~$0–5 at 0.75 checks/day                                                                            | AWS cheaper on paper              |
| Database       | Supabase Pro $25/mo (8 GB incl., auth + PostgREST + RLS + realtime + storage + pgvector + dashboard) | RDS `t4g.micro` ~$12–15 + storage, **or** Aurora Serverless v2 (0 ACU scale-to-zero) ~$1–5 storage + **$0.20/M I/O** | **Supabase far cheaper in total** |
| Auth           | included                                                                                             | Cognito, or build it                                                                                                 | **months of work**                |
| Data API / RLS | PostgREST + 148 policies, included                                                                   | build it                                                                                                             | **months of work**                |
| CI             | GitHub Actions $29/mo                                                                                | CodeBuild ~similar                                                                                                   | neutral                           |
| AI             | Anthropic $7.65/mo                                                                                   | Bedrock, same token price                                                                                            | neutral                           |

**Why AWS-everything loses:**

1. **You would be paying in engineering, not dollars.** Replacing Supabase means rebuilding auth (`auth.users`, the middleware `Promise.race` path), PostgREST, and 148 RLS policies. That is months of solo-founder time to save perhaps $30–50/month.
2. **The I/O trap.** Aurora bills $0.20/million I/Os. `scam_urls` alone has **75.2 M lifetime writes** and the review measured the feed upsert burning ~78% of dirty-page IO rewriting unchanged rows. On Aurora that inefficiency becomes a line item; on Supabase Pro it is included. (Fix that upsert either way — it is already on the backlog.)
3. **Scale-to-zero is wrong for this product.** Aurora at 0 ACU cold-starts. A scam checker's value is a fast verdict for someone who is anxious and mid-decision.
4. **Operational burden lands on one person.** VPCs, security groups, IAM, patching, backups — against a managed platform that currently gives 0 security advisor ERRORs.
5. **It optimises the wrong constraint.** $92/mo is not what is holding this business back.

**Where AWS _is_ the right answer: Bedrock (Decision B).** Use AWS for the one thing it uniquely provides — Australian-region Claude inference — and keep the managed platform for everything else. That is not a compromise; it is correct architecture.

**Revisit if:** Supabase bill exceeds ~$200/mo, or a contract mandates AWS/IRAP, or sustained traffic makes Vercel's usage pricing exceed reserved compute. None is true today.

---

## 7. Immediate cost win, unrelated to any migration

**GitHub Actions is $28.78/month — 31% of total spend** — for 16 Python scrapers plus CI. Options, cheapest first:

1. **Audit scraper cadence.** The review found `acsc` had skipped 1,080 consecutive runs across 84 days (latched breaker) and that most scrapers are manual-dispatch only while docs imply daily-fresh intel. Some of this spend is buying nothing.
2. **Cut CI minutes** — the workflow runs the full matrix on every push; scope by changed paths.
3. **Move scrapers to Vercel crons** (20 already exist) or a single small always-on instance.

Realistic saving: **$15–25/month**, i.e. comparable to the entire Supabase bill, for a few hours of work and no migration risk.

---

## 8. Cost guardrails (required before any AWS spend)

The platform already has good discipline — `feature_brakes`, `logCost()`, per-feature USD caps, `cost-daily-check`. Extend rather than replace:

**Existing, keep:** `feature_brakes` kill-switches; `readNumberEnv` caps (the `parseFloat("$10")` → NaN class is already closed); `cost_telemetry` tagged by feature+provider.

**Add for AWS/Bedrock:**

- AWS Budgets with an actual-spend alarm at 50/80/100% of a hard monthly figure, plus Cost Anomaly Detection.
- Bedrock has **no native hard spend cap** — so the app-side brake is the real control. Add a `bedrock` row to `feature_brakes` and a `BEDROCK_CAP_USD`, wired into `cost-daily-check` exactly like `reddit_intel`.
- CloudWatch alarm on Bedrock `InvocationClientErrors` + throttles.
- Per-region IAM/SCP restriction so `apac.*` and `global.*` profiles are **denied** — this makes the sovereignty property enforced by policy, not by a code comment. Given the review found this repo's dominant defect is "a comment asserting a control that does not exist", encode it in an SCP.

**Fix first, or the guardrails are theatre:** `feature_brakes` currently has **zero rows** — no brake has ever engaged — and two brakes are write-only (they announce "paused" while the feature keeps spending). `sendAdminMessage` returns `void` and swallows errors across 27 callers, so "has this alert ever fired?" is unanswerable. **Make alerting auditable before adding a new spend surface.**

---

## 9. Recommended sequence

| #   | Action                                            | Effort        | Gate                                                                               |
| --- | ------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| 1   | `"regions": ["syd1"]`                             | ~1 h          | `x-vercel-id` = `syd1::syd1`; TTFB re-measured; crons smoke-tested                 |
| 2   | Merge PR #876 (privacy/trust corrections)         | mins          | Do after 1 so the disclosure describes the good state                              |
| 3   | Decide the position on 5 pitch/grant docs         | founder       | Not mine to make — see §11                                                         |
| 4   | GitHub Actions cost audit                         | ~3 h          | Spend drops in `infra_cost_daily`                                                  |
| 5   | Make alerting auditable + brakes readable         | ~4 h          | A synthetic canary actually pages                                                  |
| 6   | Fix the promptfoo eval (secret + fail-on-missing) | ~2 h          | A real eval run, red when it should be                                             |
| 7   | Bedrock `au.*` spike behind a flag                | ~1 d          | Console-confirm Haiku 4.5 in `ap-se-2` w/ `au.*`; eval passes; SCP denies `apac.*` |
| 8   | AU report plane in `ap-southeast-2`               | ~½ d + window | Dry-run restore verified; rollback project retained 7 d                            |
| 9   | Control plane region — measure, then decide       | —             | Only if latency justifies; no compliance driver                                    |

**1–2 are worth doing this week. 3 is yours. 4–6 are prerequisites that pay for themselves. 7–8 only when the sovereignty claim is commercially load-bearing** — i.e. when a named bank, police pilot or grant actually requires it.

---

## 10. What a new context needs to know

**Read first:** this file; `docs/plans/data-residency-remediation.md`; `CLAUDE.md`; `SECURITY.md`.

**Verified facts (do not re-derive):**

- Vercel: Pro plan, project `prj_U3DtIAy2zEzrYrsXwUFCiZ2t54Bp`, team `team_DhfpTY5Zx2kTtrqjcsx3CG8F`, no `regions` key, compute `iad1`.
- Supabase: one project `rquomhcgnodxzkhokwni`, region `ap-southeast-1` (Singapore), 2,390 MB, 0 vault secrets, 8 extensions.
- Personal data = 4 MB / 28 tables / 785 rows. Corpus = 2,365 MB / 128 tables.
- Bedrock: `au.*` = AU-only; `apac.*` leaks to 6 other countries. Haiku 4.5 $1/$5 per M — same as direct.
- Costs: Vercel $30.20, GH Actions $28.78, Anthropic $7.65, Supabase $25 ⇒ **~$92/mo**.

**Landmines:**

- Restore from dump, never replay migrations (6 prod migrations have no file).
- Sensitive Vercel env vars **read back empty** on `vercel env pull` — do not conclude a var is unset from that.
- The Vercel ignore-step (`vercel-ignored-build-step.sh`) skips builds for docs/SQL-only commits; env-var changes need a commit tagged `[build]`.
- `createServiceClient()` omits the `<Database>` generic, so `.rpc()` names are unchecked at compile time — `rpcs.smoke.test.ts` is the only gate, and it covers 13 of 124 RPCs and self-skips in CI.

**Do not start 7 or 8 without 5 and 6 done.** Adding a new paid surface and a new region while alerting is unauditable and the eval never runs is how this codebase produced its existing crop of silent failures.

---

## 11. The honest framing for the business

The requirement behind all of this is a _commercial_ one — being credibly Australian for regulators, banks and police. That is a real and defensible position, and Decisions A + B + the AU report plane deliver it truthfully for **~$25/month plus a couple of days of work**.

What will not work is claiming it before it is true. Five documents (`investor-outreach`, `sales-materials`, `executive-summary`, `grant-strategy`, `aea-seed-narrative`) currently assert "Australian-hosted", "sovereign data residency" and "zero US data dependency". PR #876 flags each without rewriting them, because if any version has already reached an investor, a customer or the AEA grant body, that is a representation already made and needs a decision rather than a silent edit.

**"Zero US data dependency" should be retired permanently**, even after every step here: Google Safe Browsing, Netcraft, Inngest, Resend, Stripe and Twilio all remain overseas recipients. The accurate and still-strong claim after this work is:

> Australian-owned and operated. Your report is analysed and stored in Australia. Named overseas services are used for specific threat checks, each disclosed in our privacy policy.

That sentence is defensible, verifiable, and better positioning than an unverifiable absolute — which is the whole point of doing this honestly.
