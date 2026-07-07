# Clone Watch → Enforcement + Monetisation — Implementation Plan

_Status: DRAFT for review · Authored 2026-07-07 · Branch `clone-watch/enforcement-monetisation-plan`_

Turns Ask Arthur's live **Clone Watch** detection engine into (a) a working
**enforcement feedback loop** — fixing the "no threats found" gap the founder
surfaced from the Netcraft receipt email — and (b) a **monetisable brand-protection
ladder** (free exposure checker → per-brand Monitor subscription → managed takedown
→ enterprise threat-intel feed + SPF evidence).

Derived from a 6-agent design workflow (`wf_1bc7059c-664`, 2026-07-07). Individual
design briefs live in the session scratchpad; this plan is the reconciled,
sequenced synthesis. Grounded in ADR-0015/0016 and the clone-watch system map.

---

## 0. The problem the founder raised (answered)

**"When we report to Netcraft, obvious clones (`googlu.co`, `facebookk.xyz`,
`face-book.org`, `statestreetcollective.shop`) come back _'no threats found'_.
Does this mean Netcraft isn't taking them down? We need to press these somehow."**

**Yes — and it's fixable on two fronts:**

1. **Why Netcraft declines.** Netcraft grades on _live malicious content_, verified
   by its crawler. Our NRD sweep catches lookalikes **at registration** — before
   weaponisation. At scan time these domains are **parked / no-content / cloaked**
   (research: 96.5% of phishing kits cloak against scanner IPs/UAs; geo-cloaking to
   AU-only defeats a US-based scan). So Netcraft's automated pass sees nothing
   actionable and returns `no threats`. It is _not_ taking them down because, from
   its vantage, there is nothing malicious _yet_. There is **no appeal endpoint** in
   Netcraft's v3 API — the only re-open path is **re-submitting with fresh evidence**
   once content materially changes.

2. **Our own code makes it worse (the real bug).** `clone-watch-poll-netcraft.ts`
   treats `no threats` as a **terminal takedown** — it stamps
   `submitted_to.netcraft.takedown_at` and the alert falls out of every future poll.
   So a domain that weaponises a week later is invisible to us, **and** it's
   miscounted as a "takedown" (inflating the median-time-to-takedown KPI the monthly
   LinkedIn report publishes). Worse, the current `TERMINAL_STATES`
   (`no_action_required`, `not_phishing`) are **strings Netcraft never returns** —
   the real v3 enum is `processing / no threats / unavailable / suspicious / malicious`.
   The whole state model is mismatched.

**How we "press" them** (three levers, all in this plan):

- **Re-check loop** — keep scanning declined/parked domains. When _our_ urlscan
  flips a domain to `likely_phishing` (the contradiction: **we saw the phish,
  Netcraft didn't**), auto-re-submit to Netcraft with the fresh evidence bundle.
- **Go beyond Netcraft** — it's browser-block only. Add Google Safe Browsing +
  Microsoft SmartScreen (free, keyless, more browsers), registrar/host abuse (for
  live phishing), and **UDRP/auDRP evidence bundles routed to the brand** (the only
  lever that acts on a _parked_ trademark-infringing lookalike — passive-holding
  doctrine — but the brand files it as trademark holder, not us).
- **Package it as the product** — the multi-channel, audit-ready enforcement case
  record _is_ the managed-takedown offering enterprise buyers pay for.

---

## 1. Reconciled architecture (single source of truth)

The five design briefs independently proposed overlapping state machines, columns,
and brand-read paths. Reconciled per the cross-cutting critic:

| Concern                                                          | Owner (single home)                                                         | Consumers (read-only)                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| **Alert lifecycle** (does this domain matter / is it weaponised) | `lifecycle_state` on `shopfront_clone_alerts` (Wave 0)                      | dashboard, feed, takedown escalation trigger     |
| **Case lifecycle** (which lever pulled / approved / actioned)    | `case_status` on `shopfront_takedown_attempts` (Wave 1)                     | dashboard, SPF evidence "disrupt" log            |
| **Feed `lifecycle_state`**                                       | a **derived** `CASE` in the MV — _never_ a 4th enum                         | bank/telco SOAR                                  |
| **Evidence bundle**                                              | captured **once** on the alert (`evidence` jsonb); cases reference it       | all                                              |
| **"Lookalikes for brand X"**                                     | **one** Seam: `resolve-brand.ts` exact-match + SECURITY DEFINER masked RPC  | public teaser + entitled B2B feed (two Adapters) |
| **Dynamic watchlist**                                            | `getActiveWatchlist()` Seam in `shopfront-glue` (static + dynamic Adapters) | NRD matcher                                      |
| **Netcraft reporter standing**                                   | **one** global submission quota/brake across every submitter                | re-check, auto-batch, enforcement                |

**Non-negotiable invariants:**

- The Netcraft poll fix uses the **real v3 enum**. `malicious`/`already_blocked` →
  `taken_down`; `no threats` → `declined` (**not** terminal); `processing`/
  `suspicious`/`unavailable` → keep polling.
- **Hot-table reads go through a projection (MV), not new indexes / per-request
  scans** on `shopfront_clone_alerts`. (Resolves the brand-exposure-vs-feed conflict
  toward the MV; re-run advisors + the `pg_stat_statements` IO query before any
  consumer flag flip — CLAUDE.md rule.)
- **The itch.io circuit-breaker is a shared invariant, not one brief's feature.**
  Human-in-the-loop before any domain-level takedown send; URL-scoped (never
  domain-scoped) abuse reports; a multi-tenant-host denylist; `feature_brakes`
  kill-switch. We **never self-file UDRP/auDRP** (no trademark standing) — we
  package evidence, the brand files.
- Migration sequence is **linear**: `v199` (alert lifecycle) → `v200` (enforcement
  cases) → `v201` (brand monitoring) → `v202` (feed/evidence). `v198` is already
  taken (`brand-register`).

**De-risk confirmed this session:** the org/multi-tenancy foundation the critic
feared was missing **already exists** — `organizations`, `org_members` (with roles +
invitations), and `org_id` on `api_keys` and `subscriptions`. The only open auth
item is confirming the Supabase JWT carries the `org_id` claim used by RLS policies.

---

## 2. Waves & sequencing

```
WAVE 0  Netcraft feedback loop + lifecycle  ──┐ (this week, A$0, fully dark)
        (the founder's bug)                   │
WAVE 1  Multi-channel enforcement layer  ─────┤ builds on Wave 0 spine
        (managed takedown product)            │
WAVE 2  Free exposure funnel  ────────────────┤ revenue-visible, A$0, parallel to W1
        (Clone Watch → leads)                 │
─────────────────────────────────────────────┤ gate: F1 (JWT org claim) + F2 (Netcraft quota)
WAVE 3  Paid Brand Monitor + dashboard  ──────┤ needs org-JWT + Wave 0/1
WAVE 4  Enterprise feed + SPF evidence  ──────┘ needs brand-convergence canary + legal review

PARALLEL  justaskarthur.com 301 redirect (XS, any time) · Legal review (gates W4 + W1 human-sends)
```

### Foundations that gate the paid waves (assign an owner early)

- **F1 — Confirm/enable the `org_id` JWT claim** used by `auth.jwt() ->> 'org_id'`
  in RLS. The tables exist; verify the claim is populated before Wave 3/4 RLS ships.
- **F2 — Global Netcraft submission quota + brake.** Re-check, auto-batch, and
  enforcement all draw on the one keyless `brendan@askarthur.au` reporter standing.
  With ~20% Day-1 FP, uncoordinated submission burns it. One shared counter +
  `feature_brakes` row before Wave 1 auto-submit goes live.
- **Legal sign-off** — one review covering (a) SPF-evidence report standing
  ("evidence of _our_ detections/actions on your behalf," never "your compliance is
  satisfied") and (b) human-gated takedown sends. Gates Wave 4 and Wave 1 domain-send.

---

## Wave 0 — Netcraft feedback loop + lookalike lifecycle _(the fix; start here)_

**Migration `v199`.** New `lifecycle_state` on `shopfront_clone_alerts`
(`detected → monitoring → weaponised → reported → declined → taken_down →
dormant/expired`), plus `last_rechecked_at`, `recheck_count`, `weaponised_at`,
`netcraft_declined_at`, `evidence` jsonb; a **partial** index over the two live
re-check states; chunked backfill (≤5K) re-deriving state from real signals; RPCs
`list_clone_alerts_for_recheck` + `advance_clone_lifecycle` (guarded transitions,
one home). Regenerate `db.generated.ts`; re-run advisors.

| PR      | Scope                                                                                                                                                                                                                                                                                 | Size |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **0.1** | `v199` migration + 2 RPCs + chunked backfill + db-types regen + advisors                                                                                                                                                                                                              | M    |
| **0.2** | Fix `clone-watch-poll-netcraft.ts` to the **real Netcraft enum**; `no threats` → `declined` (not terminal, no `takedown_at`); re-add `{ cron: "0 * * * *" }`; wire `advance_clone_lifecycle`; update the `TERMINAL_STATES` unit test                                                  | S–M  |
| **0.3** | New `clone-watch-lifecycle-recheck.ts` Inngest cron (`0 */6 * * *`): candidate RPC → cheap DNS re-resolve → urlscan re-scan → emit `shopfront/clone.weaponised.v1`. Flag `FF_SHOPFRONT_CLONE_RECHECK`; `feature_brakes.shopfront_clone_recheck`; cost label `shopfront_clone_recheck` | L    |
| **0.4** | Evidence capture in `clone-watch-urlscan-retrieve.ts` (screenshot / DOM-hash / TLS / DNS → `evidence`); escalation branch in `buildSubmissionReason` (the contradiction + `prior_netcraft_uuid` + bundle)                                                                             | M    |

**Canary:** ship 0.1/0.2 dark (correctness fix to already-dark code, zero prod
change) → flip `FF_SHOPFRONT_CLONE_RECHECK` ON with Netcraft submission _still off_
(re-scan only, observe weaponisation rates for a week, zero outbound risk) → only
then enable real re-submission. **Defer:** visual pHash/TLSH (reserve
`evidence.visual_hash`, build nothing — ADR-0016 Phase C). **Open Q:** require two
scanners (urlscan + Haiku) to agree before an auto-re-submit? Can we request
AU-geo/residential urlscan vantage to beat geo-cloaking?

---

## Wave 1 — Multi-channel enforcement / managed takedown

**Migration `v200`** evolves the **unused** `shopfront_takedown_attempts` (v140)
into a case model: widen `attempt_type` (registrar/host/CF/GSB/SmartScreen/APWG/
OpenPhish/UDRP/auDRP/brand-handoff), add `case_status` (`queued → drafted →
pending_approval → submitted → acknowledged → actioned → rejected → re_emerged →
closed → skipped`), `channel_autonomy` (`auto|human_required|brand_routed`),
`acts_on_parked`, `external_ref`, `evidence_bundle` (thin per-channel pointer),
`verification_checklist`, approver + SLA columns; drop the v140 `NOT NULL` on
`body_md`/`template_version` (auto channels have no email); one-open-case-per
`(alert, channel)` unique index. RPC `merge_takedown_case`.

**Channel matrix** — new `apps/web/lib/clone-watch/enforcement/` (`channel.ts`
Interface + `matrix.ts` + one Adapter per channel). Which levers act on a **parked**
lookalike vs only **live** phishing:

| Channel                                         | Parked?           | Live? | Autonomy                                     |
| ----------------------------------------------- | ----------------- | ----- | -------------------------------------------- |
| Google Safe Browsing / SmartScreen              | ✗                 | ✓     | **auto** (reversible browser-block, keyless) |
| APWG / OpenPhish (reuse `onward-*`)             | ✗                 | ✓     | auto                                         |
| Registrar / hosting / Cloudflare abuse          | weak              | ✓     | **human-gated (permanent)**                  |
| **UDRP / auDRP evidence bundle**                | **✓ (key lever)** | ✓     | **brand-routed** (brand files; we never do)  |
| Brand security team (`brand_contact_directory`) | ✓                 | ✓     | brand-routed                                 |

| PR      | Scope                                                                                                                                                                                                                                                 | Size |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **1.1** | `v200` case-model migration + `merge_takedown_case` RPC + smoke test                                                                                                                                                                                  | M    |
| **1.2** | `channel.ts` + `matrix.ts` + **auto** Adapters (GSB/SmartScreen, APWG/OpenPhish reuse); `clone-watch-enforcement-{plan,execute}.ts`; `FF_CLONE_ENFORCEMENT` + `FF_CLONE_ENFORCE_SAFE_BROWSING`; `clone_enforcement` cost label + `feature_brakes` row | L    |
| **1.3** | Wire Wave 0's `weaponised.v1` → enforcement-plan (the escalation path for chronically-declined domains)                                                                                                                                               | S    |
| **1.4** | Human-gated Adapters (registrar/host/CF) + evidence-bundle builder + multi-tenant-host denylist; `FF_CLONE_ENFORCE_REGISTRAR`                                                                                                                         | L    |
| **1.5** | UDRP/auDRP bundle Adapters routing into `clone-watch-notify-brand`; `FF_CLONE_ENFORCE_UDRP_BUNDLE`                                                                                                                                                    | M    |
| **1.6** | `/admin/clone-watch` **Enforcement tab**: case list, detail, approval checklist, one-click actions — makes it _sellable_ (audit-ready evidence)                                                                                                       | L    |
| **1.7** | `clone-watch-reemergence-monitor.ts` cron; `FF_CLONE_REEMERGENCE_MONITOR`                                                                                                                                                                             | M    |

**Rules:** registrar/host sends **never auto-graduate** (itch.io precedent — human
gate permanent; recommend four-eyes for the first 90 days). Framed as
**phishing/DNS-abuse** (anyone-with-evidence), never trademark (brand-only). UDRP
filing fees are **the brand's cost, never ours**.

---

## Wave 2 — Free Brand Exposure funnel _(revenue-visible, A$0, parallel to Wave 1)_

Converts the monthly Clone Watch report's named brands into gated leads. **A$0
marginal cost** (Postgres reads only). Mirrors Bolster CheckPhish's free→paid split.

**Migration `v201`** (the read-only half): `brand_exposure_summary(p_brand_normalized)`
SECURITY DEFINER RPC returning `{count, earliest, masked_examples[≤5]}`, gated to
`tp_confirmed`/`tp_actioned` only, `service_role`-only EXECUTE. **Anti-scrape:**
exact resolution (inherits the `%%`-leak fix), masked teaser, work-email gate,
rate-limit + free-mail block.

| PR      | Scope                                                                                                                                                                                                                                                                | Size |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **2.1** | `getActiveWatchlist()` Seam in `shopfront-glue` (static + dynamic Adapters); refactor `shopfront-nrd-daily-ingest.ts` to depend on it; `FF_BRAND_DYNAMIC_WATCHLIST` (dark, no-op with zero rows)                                                                     | M    |
| **2.2** | Generalise `/api/clone-list-request` → `source`/`intent`; new `/brand-exposure` + `/brand-exposure/[brandSlug]` **indexable** pages; teaser via RPC; `withUtm` outreach links (`campaign=clone-watch-report`); new `logEvent` types; `NEXT_PUBLIC_FF_BRAND_EXPOSURE` | L    |
| **2.3** | `/brands` + `/superannuation` sector pages (clone `banking/page.tsx` shape)                                                                                                                                                                                          | S    |

**Funnel:** LinkedIn report names brand X → `withUtm(.../brand-exposure/<slug>)` →
masked teaser → work-email gate (`leads`, `source='brand_exposure'`) → CTA splits
**book-demo** (enterprise) vs **start-trial** (self-serve). First-touch attributes
back to Clone Watch via the existing `aa_attribution` cookie.

---

## Wave 3 — Paid Brand Monitor + dashboard _(needs F1 + Wave 0/1)_

**Migration `v201` (write half):** `monitored_brands` (cold table: `org_id`,
`brand_normalized`, `legitimate_domains[]`, `aliases[]`, `verification_status`,
`plan`) with **own-the-brand verification** (DNS-TXT `askarthur-verify=<token>` or
work-email-domain match) — only `verified` rows enter `getActiveWatchlist()`. Brand
dashboard reads the alert list via the **MV projection** (not a new RLS policy on the
hot table — reconciled toward Wave 4's MV to protect the IO budget).

**Billing — a separate SKU model**, not shoehorned into API-volume `TIER_LIMITS`.
New `BRAND_PLANS` const + `SubscriptionPlanSchema` extension:

| Plan                 | A$/mo  | Brands    | Takedowns incl. | Motion                    |
| -------------------- | ------ | --------- | --------------- | ------------------------- |
| `brand_monitor`      | 1,950  | 1         | 5/mo            | self-serve trial → Stripe |
| `brand_monitor_plus` | 2,950  | ≤3        | 15/mo           | self-serve                |
| `brand_enterprise`   | custom | portfolio | in-scope        | sales                     |

PRs: **3.1** self-registration + verification (`FF_BRAND_SELF_REGISTER`) → **3.2**
`BRAND_PLANS` + Stripe prices + trial→sub attribution → **3.3** `/brand/dashboard`
(reuses existing `NEXT_PUBLIC_FF_AUTH` + `FF_MULTI_TENANCY`; lifecycle status from
Wave 0; case-mgmt from Wave 1; share-token export). **Defer until Wave 2 proves
demand** — do not hardcode prices before a lead-volume signal.

---

## Wave 4 — Enterprise threat-intel feed + SPF evidence _(needs brand-convergence canary + legal)_

Where the A$150–400K ACVs live; strongest regulatory tailwind (SPF Act 2025,
penalties to A$50M/contravention, sector codes finalising 2026/27).

**Migration `v202`:** `feed_indicators_mv` (materialized UNION projection — the
**only** thing user-facing feed code reads; `REFRESH … CONCURRENTLY` via cron; keyset
index on `(updated_at, id)`; **no index on the hot parent**); `brand_feed_entitlements`
(API-key → brand data-isolation boundary — enforced in the RPC, not just the route);
`spf_evidence_snapshots` (immutable, hashed, point-in-time).

- **Feed API:** `/api/v1/feed/indicators?since=<keyset>&format=json|csv`,
  `/api/v1/brand/[brandKey]/alerts`, canonical `FeedIndicator` type. STIX 2.1
  **deferred behind JSON/CSV** until a SOAR partner validates the bundle. R2-cached
  per-brand exports for large pulls.
- **SPF Evidence Module:** `buildEvidencePack(brandKey, period)` mapping our
  detect/disrupt/report/respond logs to sector-code obligation IDs; monthly immutable
  snapshot; PDF. **Legal-gated; framed as evidence of our actions, never a compliance
  guarantee.** Obligation-clause map cites _exposure-draft_ codes — versioned,
  re-checked when finalised.

**Blocked on:** the brand-convergence Seam (v195–v198) being canaried (db-types regen
pending per memory) so `brand_key` joins are trustworthy; and legal review for
`FF_SPF_EVIDENCE`. **Defer:** the embeddable consumer widget (Tier C — Seam-only note
in BACKLOG).

---

## 3. "Worldwide" / justaskarthur.com — recommendation

**The clone engine is already global.** The whoisds NRD feed is all TLDs worldwide,
and the matcher is language-agnostic — the founder's own evidence
(`facebookk.xyz`, `inistagram.ir`, `googlu.co`, `dodo.com.pk`) are **not AU brands**.
Only the **watchlist** (AU-curated) and the **SPF/regulatory wedge** are AU-locked —
and SPF is the #1 differentiator that actually monetises.

**Recommendation (do not do full i18n):**

1. **Now, XS, zero-risk:** point `justaskarthur.com` at Vercel as a **301 → askarthur.au**
   (defensive; captures type-in). This is the "useful today" floor.
2. **Keep enterprise on `.au`/SPF** — the statutory moat global vendors
   (Netcraft/Bolster/ZeroFox) can't match. A `.com` global play _without_ SPF is an
   undifferentiated fight.
3. **Optional later:** a global **exposure checker** as cheap top-of-funnel (the
   engine is already global) — but honest: "exposure visibility," not "we'll take it
   down" (auDA/AU regulators are AU-only). Gate to brands actually on the watchlist.

**Defer indefinitely:** full internationalisation (non-AU watchlist, non-AU
regulators, multi-region tax, hreflang). It trades a defensible AU moat for a global
commodity fight while the SPF tailwind is still unmonetised.

---

## 4. First move (recommended)

**Ship Wave 0 PR 0.1 + 0.2 as the first PR** — the `v199` lifecycle migration + the
`clone-watch-poll-netcraft.ts` real-enum fix (`no threats` → `declined`, not
terminal). It is _literally the founder's reported problem_, it is the shared spine
four other waves read, it corrects a live KPI-inflating data bug, and it is **A$0,
fully dark, zero dependencies** — shippable this week. Land the `justaskarthur.com`
301 in parallel.

---

## 5. Open questions for the founder

1. **Netcraft standing (F2):** OK to cap total daily Netcraft submissions across all
   paths behind one shared quota + kill-switch? (Protects reporter reputation.)
2. **Two-scanner gate:** require urlscan + Haiku to _agree_ before any auto-re-submit,
   or is a single high-confidence urlscan flip enough?
3. **Enterprise-as-authorized-agent:** for a signed B2B brand, do we ever file
   registrar/UDRP _on their behalf_? (Contract + PI-insurance question — recommend
   defer to BACKLOG; v1 stays evidence-bundle-to-brand.)
4. **Wave 3/4 priority:** if a bank/super fund signals early, jump the queue to
   Wave 4 (feed + SPF evidence) ahead of self-serve Wave 3?
5. **justaskarthur.com intent:** purely defensive (stop at redirect), or a real global
   growth channel (build the global exposure checker)?

---

## Sources

Netcraft Report API v3 changelog · CloudSEK / Spoofguard (phishing-kit cloaking) ·
WIPO UDRP guide (passive-holding = bad faith) · auDA/auDRP · ICANN RAA 3.18 ·
Cloudflare / Google Safe Browsing / MS SmartScreen abuse processes ·
BrandShield/itch.io false-takedown incident · Bolster CheckPhish / Breachsense /
Red Points pricing · Treasury SPF exposure-draft + Ashurst / Corrs / G+T / HSF Kramer
analyses. (Full URLs in the design briefs, `wf_1bc7059c-664`.)
