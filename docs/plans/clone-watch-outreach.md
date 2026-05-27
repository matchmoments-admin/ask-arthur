# Clone-watch outreach — implementation plan

**Date.** 2026-05-26. **Author.** Brendan + Claude (deep-research session).
**Status.** Draft for review.
**Replaces.** Earlier ad-hoc framing in issues #411 (public-social) and #385 (cold-outreach email).

## TL;DR

The clone-watch pipeline is **live and producing real signal** (12 candidate hits across the last 2 days, ~3 of those are plausible-true-positive). The fastest, highest-value action **is not emailing brands**. It is submitting confirmed-TP URLs to community blocklist aggregators (Netcraft, Google Web Risk, APWG eCX) — Netcraft's median takedown time is 33 minutes, and browser-block protects every potential victim worldwide, not just customers of the brand we notify.

Build a **5-layer architecture** that ships incrementally; every layer is unblocked (no lawyer pack required for any of them, because every channel uses factual signal language and never characterises the operator):

1. **Triage** — admin dashboard for a 5-minute daily human pass over the daily ledger (FP / TP / needs-investigation).
2. **Community submission** — TP-confirmed rows auto-submitted to Netcraft + Google Web Risk + APWG eCX.
3. **Formal brand-direct channels** — Bugcrowd VDP (Kmart + Target), security.txt (AusPost + CBA). The brands that have explicit intake.
4. **Courtesy email to remaining brands** — the other ~46 in the watchlist. Curated fraud inbox or general contact form.
5. **AskArthur LinkedIn case-study posts** — weekly anonymised digest of clone-watch results. Marketing/credibility, never names a specific operator.

All measurable. Weekly digest extended to show clone-watch results (candidates surfaced, triaged TP, browser-blocks confirmed, brand notifications sent, median time-to-takedown).

**The lawyer pack (#371) is irrelevant to this plan.** That gate only applies if we ever decide to publicly name a specific operator (which is not what any of the 5 layers above does). It can stay in its current `ready-for-human` slot, gating other things (badge disclaimer, public consumer pages), but it is not blocking any clone-watch work.

---

## 1. What the data actually shows

Pulled live from `shopfront_clone_alerts` on 2026-05-25:

| Day        | Hits | Brands                                 | Notes       |
| ---------- | ---- | -------------------------------------- | ----------- |
| 2026-05-25 | 7    | Bonds, Domino's, Kmart, Sendle, Target | Today's run |
| 2026-05-24 | 5    | Coles, Kmart, Target, Westpac          | Yesterday   |

The matcher scans **~70,000 newly-registered domains per day** (whoisds daily NRD zip, free tier) against a 50-entry AU brand watchlist. Two earlier runs (pre-#408 v2 matcher) returned 432 + 17 hits — that noise is fixed; current rate is 5–7/day.

### Eyeball FP audit of the 12 most-recent hits

| Candidate                        | Brand    | Signal    | Verdict          | Why                                       |
| -------------------------------- | -------- | --------- | ---------------- | ----------------------------------------- |
| `bons.bid`                       | Bonds    | Lev-1     | **TP plausible** | `.bid` high-risk gTLD; one-edit typosquat |
| `qkmart.com`                     | Kmart    | Lev-1     | **TP plausible** | One-edit typosquat on `.com`              |
| `westpachomesb.info`             | Westpac  | substring | **TP plausible** | "westpac" + "home" + `.info`              |
| `target-ads.pro`                 | Target   | substring | ambiguous        | Reads like adtech but unverified          |
| `sendly.id`                      | Sendle   | Lev-1     | likely FP        | Real Indonesian/competing brand           |
| `dominios.website`               | Domino's | Lev-1     | **FP**           | Spanish "dominios" = domains              |
| `penbrookmart.shop`              | Kmart    | substring | likely FP        | Plausible real store name                 |
| `daleswickmart.shop`             | Kmart    | substring | likely FP        | Plausible real store name                 |
| `jasperwickmart.shop`            | Kmart    | substring | likely FP        | Plausible real store name                 |
| `autonomoustargetingnetwork.com` | Target   | substring | **FP**           | "Targeting", not Target                   |
| `autoecolesoultbycfconduite.fr`  | Coles    | substring | **FP**           | French "auto-école", #409 v3 fix pending  |
| `targetspheresolutions.shop`     | Target   | substring | likely FP        | Real-sounding consultancy                 |

**Eyeball FP rate ≈ 58–75%.** Higher than the 20% Day-1 measurement in the ops doc — likely because Day-1 lucked into more typosquat hits and fewer substring-noise hits. Either way: **this signal is not clean enough for automated outreach**. A 5-minute human triage gate is non-negotiable.

The plausible-TPs are still real and worth acting on. `qkmart.com`, `bons.bid`, `westpachomesb.info` are exactly the kind of domain that becomes a phishing landing page within a week of registration. Doing nothing on those is a real cost.

### Cost-telemetry verification

Daily runs are landing in `cost_telemetry` with `feature='shopfront_clone_watch'`, A\$0 marginal spend (whoisds free tier, no AI calls in the matcher). The pipeline is operationally cheap.

---

## 2. Industry landscape — channels we can use

Researched 2026-05-25. Four categories of channel ordered by speed-to-victim-protection:

### Category A — Community blocklist aggregators (FASTEST, GLOBAL)

These are the channels that protect every potential victim, not just one brand's customers.

| Service                                          | What it does                                                                      | Submit how                  | Cost                                                         | Notes                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| **Netcraft** `report.netcraft.com`               | Detects + drives takedown via registrar/host; feeds browser + AV vendors          | REST API (v3)               | Free for ad-hoc reports                                      | **Median takedown 33 min** — flagship metric            |
| **Google Web Risk Submission API**               | Adds URL to Safe Browsing blocklist; blocks in Chrome/Firefox/Safari (4B devices) | `projects.uris.submit` REST | Contact sales; not free                                      | Single most powerful lever; high friction to get access |
| **Google Safe Browsing Lookup API** (free tier)  | Read-only check, NOT submission                                                   | `threatMatches.find` REST   | Free 100k/mo                                                 | Already used elsewhere in codebase                      |
| **APWG eCrime eXchange (eCX)** `/phish` endpoint | Industry phishing data clearinghouse; consumed by browsers + AV + researchers     | REST, member-only           | Free for verified researchers; AskArthur eligibility unknown | Need to apply for membership                            |

### Category B — Government channels (SLOW, AU-SPECIFIC)

| Service              | What it does                                               | Submit how            |
| -------------------- | ---------------------------------------------------------- | --------------------- |
| **ACSC ReportCyber** | National coordination, may feed cyber.gov.au alerts        | Web form only; no API |
| **ASIC Moneysmart**  | Investment-scam-specific (rarely applies to retail clones) | Web form only         |
| **AFP**              | Criminal investigation, not takedown                       | Web form / phone      |

Best modelled as "we file ReportCyber once a month with a batch CSV" — low signal vs the API channels above.

### Category C — Brand-direct formal channels (HIGH-CONFIDENCE recipient)

Channels where the brand has explicitly published an intake protocol.

| Channel                        | Coverage in AU watchlist (50 brands) | How                                               |
| ------------------------------ | ------------------------------------ | ------------------------------------------------- |
| **Bugcrowd VDP — Kmart Group** | Kmart + Target Australia (in scope)  | Public VDP submission page                        |
| **security.txt** (RFC 9116)    | AusPost, CommBank                    | `/.well-known/security.txt` parsed for `Contact:` |

**Concrete coverage probe (run today, 20 brands):**

- ✅ `auspost.com.au/.well-known/security.txt` — `security@auspost.com.au` (PGP)
- ✅ `commbank.com.au/security.txt` — `vulnerability@cba.com.au` (PGP, Expires 2024 but contact lives)
- ❌ Every other brand (Kmart, Target, Woolworths, Coles, Westpac, NAB, ANZ, Telstra, Optus, Vodafone, etc) returns no security.txt
- ⭐ **Bugcrowd VDP Pro** covers Kmart + Target (both via Kmart Group umbrella) — the single highest-value brand-direct channel

Total formal-channel coverage: **4 of 50 brands** (Kmart, Target, AusPost, CommBank).

### Category D — Brand-direct courtesy email (REMAINING ~46 brands)

For brands without formal intake, a polite "FYI" email to a curated fraud / abuse / general contact. Lower confidence (we're guessing the right recipient), but still useful and zero legal exposure.

Curation work: one afternoon to build a 50-row directory by hand — `{brand, channel_type, recipient, evidence_format}`. Permanent data, no ongoing churn.

### Category E — Public credit-grab (case-study LinkedIn posts)

AskArthur publishing weekly summaries that anonymise the operator domain (e.g. "we detected a Kmart typosquat on `.com` and reported it within 1 hour; browser-block confirmed in 18 minutes"). Never names the specific candidate domain in the post body. Builds AskArthur as the AU clone-detection authority. No lawyer needed because no operator is named.

The thing that genuinely needs a lawyer — publicly naming an operator on X/LinkedIn ("`fake-kmart.shop` is a scam") — is **out of scope for this plan**. That decision can be revisited later if and when #371 lawyer pack ships for other reasons, but it adds little incremental value over the 5 layers below.

---

## 3. Proposed architecture

```
                Daily NRD run (08:30 UTC)
                          │
                          ▼
            shopfront_clone_alerts (existing table)
                          │
                          ▼
     ┌─────────────────────────────────────────────┐
     │  LAYER 1 — Admin Triage Dashboard           │  Phase 1
     │  /admin/clone-watch                          │  (this week)
     │   - per-row eyeball                          │
     │   - mark FP / TP / needs-investigation       │
     │   - writes shopfront_clone_alerts.triage     │
     └─────────────────────────────────────────────┘
                          │
                  (only TP rows proceed)
                          │
        ┌─────────────────┼─────────────────┬─────────────────┐
        ▼                 ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ LAYER 2      │  │ LAYER 3      │  │ LAYER 4      │  │ LAYER 5      │
│ Community    │  │ Formal brand │  │ Courtesy     │  │ AskArthur    │
│ submission   │  │ channels     │  │ email        │  │ LinkedIn     │
│              │  │ (Bugcrowd /  │  │ (everyone    │  │ case-study   │
│ Netcraft +   │  │ security.txt)│  │ else — ~46   │  │ post (weekly)│
│ Google Web   │  │              │  │ brands)      │  │              │
│ Risk + APWG  │  │              │  │              │  │              │
│              │  │              │  │              │  │              │
│ Phase 2      │  │ Phase 3      │  │ Phase 4      │  │ Phase 5      │
│ (2 wks)      │  │ (1 wk)       │  │ (1-2 wks)    │  │ (1 wk)       │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
        │                 │                 │                 │
        ▼                 ▼                 ▼                 ▼
  Browser-block      Bugcrowd VDP      Friendly FYI to    Marketing +
  via Netcraft       triages within    fraud/abuse        SPF enterprise
  ~33 min            their SLA;         inbox; some        lead-gen
                     security.txt       brands ignore,
                     reaches NOC        some forward to
                                        registrar
```

The architecture is **fan-out from a single triage decision** — once a row is flagged TP, every downstream channel fires (Layers 2 + 3 + 4 in parallel). Layer 5 is a separate weekly cadence summarising the whole pipeline.

Asymmetric value:

- **Layer 2** protects victims (the only layer that does this directly via browser block)
- **Layer 3** reaches brand security teams via known protocols — highest brand-response confidence
- **Layer 4** reaches everyone else via lowest-friction channel — relationship-builder, low confidence
- **Layer 5** builds AskArthur public credibility → consumer growth + SPF enterprise feed (#368) lead-gen

A clean separation also means each layer ships independently. Phase 1 + 2 deliver the victim-protection value; Phases 3 / 4 / 5 layer on later without blocking Phase 1.

---

## 4. Schema additions

Minimal — extend the existing `shopfront_clone_alerts` table; do NOT create new tables until Layer 3+.

```sql
-- Migration v143 (next available; v142 was RLS in #413)
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN triage_status text
    CHECK (triage_status IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned'))
    DEFAULT 'pending',
  ADD COLUMN triage_by uuid,                    -- admin user_id who triaged
  ADD COLUMN triage_at timestamptz,
  ADD COLUMN triage_notes text,
  ADD COLUMN submitted_to jsonb DEFAULT '{}'::jsonb;
  -- submitted_to = {
  --   "netcraft": {"id":"<uuid>","submitted_at":"...","status":"...","takedown_at":"..."},
  --   "google_web_risk": {...},
  --   "apwg": {...},
  --   "bugcrowd": {...},
  --   "security_txt": {...},
  --   "courtesy_email": {...}
  -- }

CREATE INDEX idx_clone_alerts_triage_pending
  ON public.shopfront_clone_alerts (first_seen_at DESC)
  WHERE triage_status = 'pending';
```

For Phase 3 + 4 the `brand_contact_directory` is a small new table:

```sql
CREATE TABLE public.brand_contact_directory (
  brand text PRIMARY KEY,
  channel_type text NOT NULL CHECK (channel_type IN ('bugcrowd_vdp','security_txt','fraud_inbox','contact_form','none')),
  recipient text,                  -- email / URL depending on channel_type
  evidence_format text NOT NULL DEFAULT 'plain_email',
  notes text,
  updated_at timestamptz DEFAULT now()
);
```

Idempotent + cheap. RLS service-role only.

---

## 5. Phase 1 — admin triage dashboard (THIS WEEK)

**Scope.** A single `/admin/clone-watch` page accessible to admin users. Shows the daily ledger with a triage button per row. Zero outreach yet — just the foundation.

**Acceptance criteria.**

- [ ] Migration v143 applied (schema above, minus `brand_contact_directory` which comes in Phase 3)
- [ ] `/admin/clone-watch` route renders pending rows newest-first, grouped by day
- [ ] Per row: brand, candidate domain, signal type/score, severity, "View" button (opens candidate URL via SSRF-guard proxy so we don't directly hit attacker infra from the admin browser), three triage buttons (FP / TP / Investigate)
- [ ] Triage decision writes `triage_status`, `triage_by`, `triage_at`, `triage_notes`
- [ ] Daily Telegram digest already exists — extend to surface "N rows awaiting triage" so it's visible at 8AM
- [ ] No public surface change — `/clone-watch` consumer page unchanged
- [ ] Plausible event `clone_watch_triage_decision` fires per triage action (for measurement — §10)

**Cost.** A\$0 marginal. Whole build ≤ 1 day.
**Risk.** None — admin-only, no outbound action, no legal exposure.
**Issue.** Open `[Shopfront S0E.x] Layer 1 admin triage dashboard + schema v143`.

---

## 6. Phase 2 — community blocklist submission (2 WEEKS OUT)

**Scope.** When a row is marked `tp_confirmed`, an Inngest function fires submissions to Netcraft + Google Web Risk + APWG eCX. Records the response IDs in `submitted_to` for audit. Sends a Telegram confirmation.

**Acceptance criteria.**

- [ ] Netcraft Report API v3 wired up (sign up for free API key; no contract needed for ad-hoc reports)
- [ ] Google Web Risk Submission API access requested via Google Cloud sales — fallback if rejected: skip this layer, rely on Netcraft + APWG (Netcraft already feeds Google Safe Browsing indirectly)
- [ ] APWG eCX membership applied — fallback if rejected: skip
- [ ] Inngest fn `shopfront-clone-submit-blocklists` triggers on `triage_status` transition to `tp_confirmed`
- [ ] Cost telemetry: `feature='shopfront_clone_submit'` per submission; brake at A\$5/day
- [ ] Per-pairing dedupe: never submit the same `(provider, candidate_domain)` twice
- [ ] Polling job updates `submitted_to.<provider>.status` + `takedown_at` so we can compute median time-to-takedown (the headline measurement for §10)

**Cost.** Netcraft free for ad-hoc, Google Web Risk likely paid (TBD on sales call). Inngest function cost negligible. Conservative budget A\$50/mo until Google quotes.
**Risk.** Low. Submissions are factual ("URL X matches brand Y at confidence Z"). Netcraft + Google take responsibility for the takedown decision.
**Issue.** Open `[Shopfront S0E.x] Layer 2 community blocklist submission`.

**Why this is the highest-leverage phase.** Netcraft's 33-min median takedown means a victim browser-blocking the URL within ~1 hour of the daily 08:30 UTC run. The clone never gets to its first victim if the matcher catches it on day-1 of registration. **This is where the consumer-protection value of the whole platform lives.**

---

## 7. Phase 3 — formal brand-direct channels (1 WEEK, parallel with Phase 2)

**Scope.** For brands with a published intake protocol (Bugcrowd VDP, security.txt), send a structured evidence pack via that channel when a row is `tp_confirmed`. Coverage at MVP: Kmart + Target (Bugcrowd VDP), AusPost + CommBank (security.txt). Four brands of fifty, but they're high-value brands and these channels have the highest brand-response confidence.

**Acceptance criteria.**

- [ ] `brand_contact_directory` rows for Kmart, Target, AusPost, CommBank populated
- [ ] Bugcrowd VDP submission script (Kmart Group covers Kmart + Target). Manual-form-fill for v1; their public form doesn't expose a write API. The admin dashboard surfaces a "Open Bugcrowd report" button that pre-fills the form via URL query params where supported, otherwise opens a new tab with the evidence pack copy-pasted to clipboard.
- [ ] security.txt PGP-encrypted email send for AusPost + CommBank — automated via Resend with the brand's published public key
- [ ] React Email template `clone-watch-brand-formal.tsx` — subject + body uses factual signal language ("we detected X matching your brand at signal Y, score Z; reported to Netcraft / Google Web Risk")
- [ ] 30-day per-brand-per-candidate suppression so we never re-send for the same pairing
- [ ] Plausible event `clone_watch_brand_notify` with `{brand, channel_type}` (for §10 measurement)
- [ ] Cost telemetry `feature='shopfront_clone_notify_formal'`; brake at A\$2/day (Resend is cheap, this is just a guard)

**Cost.** Resend per-email (negligible) + 2hrs to build the 4-brand directory. A\$0–5/mo.
**Risk.** Very low. Recipient is the brand's published intake, we're using their declared protocol, language is factual signal only.
**Issue.** Open `[Shopfront S0E.x] Layer 3 formal brand-direct channels (Bugcrowd + security.txt)`.

---

## 8. Phase 4 — courtesy email to remaining brands (1-2 WEEKS, after Phase 3)

**Scope.** For the other ~46 brands without a formal channel, hand-curate the best-available recipient (fraud inbox / abuse inbox / general contact) and send a polite "FYI" courtesy email when a row is `tp_confirmed`. Manual-approval-gated for v1 (admin reviews + clicks Send per row).

**Acceptance criteria.**

- [ ] `brand_contact_directory` populated for the remaining ~46 brands (one afternoon — search each brand's site for "report fraud" / "report phishing" / privacy contact, save to the table)
- [ ] React Email template `clone-watch-brand-courtesy.tsx`
  - Subject: "FYI — possible clone domain matching [brand] surfaced today"
  - Body: short, friendly, plain English. Introduces AskArthur briefly (one sentence). Names the candidate domain. States the signal in plain language ("registered today, the domain name is one letter off your brand"). Links to a public evidence page on `/clone-watch/<id>` (admin-gated for now; can be made public later). Includes "if this is a real business you know, please let us know and we'll deprioritise". STOP-to-suppress instruction at the bottom.
- [ ] Admin dashboard Layer 4 panel: "Notify brand" button per `tp_confirmed` row → previews the email → admin clicks Send
- [ ] 30-day suppression per (recipient_email, candidate_domain) pairing
- [ ] Plausible event `clone_watch_brand_notify` with `{brand, channel_type:"courtesy_email"}`
- [ ] Cost telemetry `feature='shopfront_clone_notify_courtesy'`; brake at A\$5/day
- [ ] Inbound reply tracking — set up `clone-watch-replies@askarthur.au` alias; admin dashboard surfaces any inbound reply alongside the original send

**Cost.** Resend per-email (negligible) + 4hrs to hand-curate 46 brand contacts. A\$0–10/mo.
**Risk.** Low. Private 1:1 email to the named alleged victim. Recipient is sometimes the wrong person (general contact form may take days/weeks to route), but no legal exposure — we're just saying "we noticed a domain, FYI."
**Issue.** Open `[Shopfront S0E.x] Layer 4 courtesy email to remaining brands` — supersedes #385's old scope.

**Manual-approval gate timeline.** Keep manual-send for the first 30 brand notifications. After 30, review the response distribution: if zero defamation-class objections + reply rate is informative, lift the gate to auto-send. If any brand replies negatively, hold the gate longer.

---

## 9. Phase 5 — AskArthur LinkedIn case-study posts (1 WEEK, anytime after Phase 2 ships)

**Scope.** Weekly LinkedIn post (Sunday or Monday) summarising the prior week's clone-watch results. Anonymised — never names a specific candidate operator domain in the post body. Generic-stats + 1-2 sanitised case studies per week.

**Acceptance criteria.**

- [ ] React Email template (re-used) → markdown formatter → LinkedIn post copy generator
- [ ] Per-week aggregation SQL (called weekly by an Inngest cron, Sunday 09:00 UTC):
  - candidates surfaced
  - triaged TP / FP / awaiting-triage counts
  - community submissions sent + browser-blocks confirmed
  - median + P90 time-to-takedown (Netcraft, Google Web Risk)
  - brands notified (count by channel: formal vs courtesy)
  - notable case study 1: "we caught a Kmart typosquat on `.com` one day after registration; Netcraft removed it in 22 minutes" (no candidate domain in body)
- [ ] Telegram preview to admin chat (Sunday 09:00) — manual approval, then post to LinkedIn. Auto-post is post-MVP; first 4 weeks are manual to calibrate tone.
- [ ] UTM tagging on any AskArthur links in the post (`utm_source=linkedin&utm_campaign=clone_watch_weekly`)
- [ ] Plausible event `clone_watch_linkedin_post_published` with `{week_start, brands_count, submissions_count}` so we can correlate posts → inbound traffic / SPF lead-gen
- [ ] Cost telemetry `feature='shopfront_clone_linkedin_digest'`; A\$0 marginal (LLM-free, just SQL + markdown)

**Cost.** A\$0/mo (no AI calls, just aggregation + manual post).
**Risk.** Negligible — generic stats + anonymised case studies, no operator naming.
**Issue.** Open `[Shopfront S0E.x] Layer 5 AskArthur LinkedIn case-study posts (weekly)`.

**Why this matters for the platform.** The LinkedIn post is the leading indicator for SPF enterprise feed (#368) inbound interest. Brand fraud/legal teams discover AskArthur organically through these posts (rather than us cold-pitching them). Over time, the posts become the public record of "AskArthur is the AU clone-detection authority", which is the moat for both consumer growth and enterprise sales.

---

## 10. Measurement + weekly digest integration

The whole point of this plan is that **every stage of the funnel is observable**. Measurement is built in from Phase 1, not bolted on.

### Metrics to track per row (in `shopfront_clone_alerts.submitted_to` JSON)

| Stage                     | Field                                                                      | Type                  |
| ------------------------- | -------------------------------------------------------------------------- | --------------------- |
| Triage                    | `triage_status`, `triage_at`, `triage_by`                                  | enum, timestamp, uuid |
| Layer 2 — Netcraft        | `submitted_to.netcraft.id`, `.submitted_at`, `.takedown_at`, `.status`     | string, ts, ts, enum  |
| Layer 2 — Google Web Risk | `submitted_to.google_web_risk.{id,submitted_at,blocklist_added_at,status}` | same                  |
| Layer 2 — APWG            | `submitted_to.apwg.{id,submitted_at,status}`                               | same                  |
| Layer 3 — Bugcrowd        | `submitted_to.bugcrowd.{report_id,submitted_at,status}`                    | same                  |
| Layer 3 — security.txt    | `submitted_to.security_txt.{email_sent_at,reply_at,reply_action}`          | ts, ts, enum          |
| Layer 4 — Courtesy email  | `submitted_to.courtesy_email.{email_sent_at,reply_at,reply_action,bounce}` | ts, ts, enum, bool    |

### Aggregate metrics (computed weekly)

| Metric                             | Formula                                                                          | Surfacing                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Daily candidates surfaced          | count of rows by day                                                             | Existing Telegram digest                             |
| Triage backlog                     | count of rows `triage_status='pending'`                                          | Daily Telegram digest                                |
| FP rate (eyeball)                  | `fp / (fp+tp_confirmed)`                                                         | Weekly Telegram digest                               |
| TP rate                            | `tp_confirmed / triaged_total`                                                   | Weekly Telegram digest                               |
| Community submission coverage      | `submissions_sent / tp_confirmed`                                                | Weekly Telegram digest                               |
| Median time-to-takedown (Netcraft) | `median(takedown_at - submitted_at)`                                             | **Headline metric** in weekly digest + LinkedIn post |
| Browser-block confirmation rate    | `blocklist_added / submissions_sent` (Google Web Risk)                           | Weekly Telegram digest                               |
| Brand notification reply rate      | `replied / sent` by channel                                                      | Weekly Telegram digest                               |
| Brand takedown attribution         | rows where brand replied "we're on it" / "filed with registrar"                  | Monthly review                                       |
| LinkedIn post → inbound traffic    | Plausible `utm_source=linkedin` sessions in 7 days after post                    | Weekly LinkedIn-post review                          |
| LinkedIn post → SPF lead-gen       | inbound `/contact?intent=spf_feed` referrals attributable to clone-watch content | Monthly review                                       |

### Weekly digest integration (existing Sunday Telegram cost digest)

Add a new section to the existing weekly cost-digest Telegram message (it already runs Sundays per the screenshot you sent). New section:

```
🛡️ Clone-watch week ending [date]
Candidates: 47 (avg 6.7/day)  ·  Triage backlog: 3
TP confirmed: 14 (30%)  ·  FP: 25 (53%)  ·  Investigate: 5
Community submissions: 14 sent  ·  Netcraft median takedown 28 min
Browser-block confirmed: 11/14 (Netcraft) · 9/14 (Google Web Risk)
Brand notifications: 14 sent (4 formal · 10 courtesy)  ·  3 replies received
Notable: caught Kmart typosquat on .com day-1, blocked in 22 min
Full breakdown: askarthur.au/admin/clone-watch
```

This is the operator-facing version. The LinkedIn case-study post (Phase 5) is a sanitised + narrative version of the same data, posted publicly.

### Public-facing measurement surface (post-Phase-5)

Add a "Clone-watch impact" section to `/clone-watch` (the existing public page, currently noindex'd pending #371 v1 copy). Reads from the same aggregate metrics. Public-safe shape:

> Last 30 days: 192 candidate clones surfaced across 23 AU brands. 87 confirmed clones reported. Median time-to-browser-block: 31 minutes. AskArthur clone-watch is helping protect Australians from scam shopfronts before they get their first victim.

No operator naming, no per-candidate detail. Pure aggregate impact. This becomes the "trust the platform" proof for both consumers and enterprise prospects.

---

## 11. Open decisions for sign-off

1. **Triage cadence — daily vs on-demand?** Recommend daily 5-min pass after 08:30 UTC Telegram digest. Alternative: rate-limit to 3×/week if daily becomes burdensome.
2. **Layer 2 fallback path if Google Web Risk Submission access is denied?** Recommend: rely on Netcraft only (their submissions feed Google indirectly). Skip the direct API.
3. **Brand contact directory — hand-curated or auto-discovered?** Recommend: hand-curate for v1 (50 brands is one afternoon's work; the data is permanent and won't churn). Add automated security.txt discovery in v2 if the watchlist grows past 200 brands.
4. **Phase 4 manual-approval gate — how long until auto-send?** Recommend: keep manual for first 30 brand notifications; lift the gate after we've seen the brand-response distribution and confirmed zero defamation-class objections.
5. **Phase 5 cadence — weekly vs bi-weekly?** Recommend weekly (Sunday/Monday post). High enough cadence to build the "AskArthur knows what's happening in AU clone-detection" muscle. Re-evaluate after 8 weeks based on engagement.
6. **Should we delete `dominios.website`, `autonomoustargetingnetwork.com`, `autoecolesoultbycfconduite.fr` style FPs from the table once triaged, or keep them as training data?** Recommend: keep, but expose only `triage_status != 'fp'` in the public `/clone-watch` page. Use the FP cohort to improve the matcher (Phase B Voyage embeddings, #384, will use this as eval data).

---

## 12. Cost + risk summary

| Phase                     | Time-to-ship    | Cost (monthly) | Legal risk             | Victim-protection value                             |
| ------------------------- | --------------- | -------------- | ---------------------- | --------------------------------------------------- |
| 1 — Triage dashboard      | 1 day           | A\$0           | None                   | Foundational; no direct value                       |
| 2 — Community submission  | 2 wks           | A\$0–50        | Very low               | **High** (browser-block via Netcraft 33-min median) |
| 3 — Formal brand channels | 1 wk (parallel) | A\$0–5         | Very low               | Medium (4 high-value brands; published intake)      |
| 4 — Courtesy email        | 1-2 wks         | A\$0–10        | Low (private, factual) | Medium (relationship-building, lower confidence)    |
| 5 — LinkedIn case studies | 1 wk            | A\$0           | Negligible             | Marketing → SPF enterprise lead-gen                 |

**Total to ship Phases 1–5: ~5 weeks of build, A\$60/mo all-in, zero legal exposure.**

The earlier framing that Phase 4 (was: public callout) needed A\$3–5K of lawyer pack was overcautious — that only applies if we ever decide to publicly name a specific operator on X/LinkedIn, which is not what any of the 5 layers above does. The lawyer pack (#371) remains relevant to OTHER surfaces (badge disclaimer, public consumer pages) but is not in this plan's critical path.

---

## 13. Related issues / files

- #411 Public-social outreach loop — **repurpose** for Layer 1 triage dashboard scope, archive the public-X/LinkedIn-naming-operator framing
- #385 Cold-outreach pipeline — **repurpose** for Layer 4 courtesy email; the original "claim-your-badge" Verified Directory flywheel framing belongs in #375 / #377 instead
- #371 Lawyer-vetted disclaimer pack — **not blocking** any phase of this plan; keep it where it is
- #412 Clone-watch cost + safety monitoring — already `ready-for-agent`, ships alongside Phase 2 brake
- #406 Soft-expiry rule for old open alerts — auto-FP rows after 90 days `pending`, lower priority than Phase 1
- #409 v3 matcher `au` token word-boundary fix — independent quality improvement; ship whenever
- `packages/shopfront-glue/src/lexical-match.ts` — the matcher (no changes for this plan)
- `packages/shopfront-glue/src/au-brand-watchlist.ts` — 50-brand list (drives Phase 3/4 contact directory)
- `apps/web/app/clone-watch/page.tsx` — public surface (gets a "Clone-watch impact" stats section in Phase 5)
- `docs/ops/clone-watch-config.md` — extend with §8 Outreach Channels (added in Phase 2)
- `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts` — daily cron (no changes for this plan)
- Existing Sunday Telegram weekly cost digest — extended with new clone-watch section (Phase 1)

---

## 14. Next actions

If approved as scoped:

1. Open issue `[Shopfront S0E.x] Layer 1 admin triage dashboard + schema v143 + weekly-digest section` (this week)
2. Open issue `[Shopfront S0E.x] Layer 2 community blocklist submission (Netcraft + Google Web Risk + APWG)` (next week, parallel)
3. Open issue `[Shopfront S0E.x] Layer 3 formal brand-direct channels (Bugcrowd + security.txt)` (in parallel with Phase 2)
4. Open issue `[Shopfront S0E.x] Layer 4 courtesy email to remaining brands` (after Phase 3)
5. Open issue `[Shopfront S0E.x] Layer 5 AskArthur LinkedIn case-study posts (weekly)` (anytime after Phase 2)
6. Sign up for Netcraft Report API key + apply for APWG eCX membership + request Google Web Risk sales call (parallel, no engineering required)
7. Hand-curate the 50-row `brand_contact_directory` (one afternoon; can run in parallel with Phase 1 build)

---

## 15. Measurement-closure follow-up (post-PR-#424 ship)

**Status.** PR #424 merged 2026-05-26. Layers 1-5 live behind feature flags; `FF_SHOPFRONT_CLONE_OUTREACH=true` set in Vercel prod. Three measurement gaps identified post-merge that turn "queryable in SQL" into "visible everywhere it matters":

### Phase A — Measurement closure ✅ SHIPPED (PR #425)

1. **Per-brand historical table in `/admin/clone-watch`** — new RPC `clone_watch_brand_breakdown(p_days)` returning per-brand totals; render as sortable table below the pending list. Columns: brand, total candidates, TP count, FP rate, Netcraft submits, brand notifications, last hit.
2. **Public impact stats on `/clone-watch` consumer page** — gated 30-day aggregate section: "N candidates surfaced, M confirmed clones, K browser-blocks via Netcraft". Never names a specific candidate domain. Renders only when `FF_SHOPFRONT_CLONE_OUTREACH=true`.
3. **Tests for the 3 new Inngest functions** — vitest mocks of Resend, Supabase, Inngest. Covers flag-off short-circuit, dedup, channel routing for each.
4. **System-map docs sync** — add the 3 new Inngest fns to `docs/system-map/background-workers.md`; add the 4 new flags to `docs/system-map/feature-flags.md`.

**Dropped from Phase A after audit:** server-side Plausible events (no helper exists; `cost_telemetry` already provides per-feature event counts + metadata that surface in `/admin/costs`). Pre-inserting a `feature_brakes` row is also unnecessary — the table is pause-state, not pre-config caps; the existing `cost-daily-check` cron handles it via `DAILY_COST_THRESHOLD_USD` + per-feature env caps like `SHOPFRONT_CLONE_OUTREACH_CAP_USD`.

### Phase A.3 — urlscan.io auto-scan + classify ✅ SHIPPED (PR #432 + #433)

Shipped after Phase A as an independent layer:

1. **Auto-scan** every new NRD candidate via urlscan.io within ~90s of ingest. `shopfront-clone-urlscan` Inngest fn submits + sleeps 60s + 30s retry + retrieves + auto-classifies + persists via atomic RPC.
2. **Daily re-scan cron** (Sun 11:00 UTC) for stale rows within a 60-day seasoning window (bumped from 30 days in v149 per ultrareview F22 follow-up).
3. **Auto-classification**: `parked_for_sale` (Afternic/Sedo/etc — suffix match) / `unresolved` (NXDOMAIN) / `likely_phishing` (urlscan `verdicts.malicious`) / `neutral`. Conservative triage transitions: parked + unresolved → `needs_investigation`; `likely_phishing` STAYS on pending queue (operator confirms manually so the event-emit + downstream fan-out fires correctly).
4. **Admin dashboard**: classification chip + screenshot thumbnail per row + "Scan now" / "Re-scan" button. Soft rate-limit 20 scans/hour.
5. **Cost**: A\$0 (urlscan free tier 100/day; actual use ~60/day with full re-scan cron). Folded into the existing `SHOPFRONT_CLONE_OUTREACH_CAP_USD` brake aggregate.

### Phase B — Time-to-takedown tracking ✅ SHIPPED (PR #425)

1. New Inngest cron `shopfront-clone-poll-netcraft-status` running every 30 min.
2. Queries `shopfront_clone_alerts WHERE submitted_to.netcraft.uuid IS NOT NULL AND submitted_to.netcraft.takedown_at IS NULL`.
3. Hits Netcraft v3 status endpoint for each, updates `submitted_to.netcraft.{state, takedown_at}`.
4. Powers a "median time-to-takedown" KPI in the admin dashboard + weekly digest + LinkedIn post.

**Blocked by:** real `NETCRAFT_REPORT_API_KEY` in Vercel prod. Phase A ships before this.

### Phase C — Brand-reply inbound tracking (next PR after B)

1. `clone-watch-replies@askarthur-inbound.com` alias via Cloudflare Email Routing (existing pattern — `docs/ops/inbound-email-config.md`).
2. Cloudflare Worker → Supabase Edge Function → new `clone_alert_brand_replies` table.
3. Reply classifier (small heuristic): STOP / acknowledgement / takedown-confirmation / FP-correction.
4. Surface in admin dashboard alongside the original send. Auto-suppression on STOP.

**Blocked by:** Phase A ships first. No external deps beyond the existing inbound-email Cloudflare/Supabase plumbing.

### Phase D — Public-facing trust building (future, post-Phase-C)

1. `/clone-watch` public page (currently `noindex`) gets the lawyer-vetted v1 copy (#371 in BACKLOG), flip to `index,follow`.
2. SEO-friendly per-brand sub-pages `/clone-watch/<brand>` summarising the brand's clone history (anonymised).
3. Weekly Telegram digest → LinkedIn post → re-published on the blog as a "30-day clone-watch report" cadence.

**Gating:** lawyer pack #371 ship.

### Phase E — Batch-approval + bank-channel hardening ✅ SHIPPED (PRs #468–#489)

Driven by the first live e2e test on 2026-05-27 (NAB clone alert 487). Surfaced four classes of issue that the original Phases 3/4 design didn't account for; each fix shipped as a focused PR or migration. **Status: all code-complete, all flags ON, `FF_SHOPFRONT_CLONE_NOTIFY_BRAND` ON in prod, first live NAB send at 09:24 UTC.**

1. **Admin-auth recovery** (PRs #460–#467 + #473). Pre-existing HMAC-token middleware fell through to Edge runtime, which can't verify the HMAC. Moved middleware to Node.js runtime; trimmed `ADMIN_SECRET` / `UNSUBSCRIBE_SECRET` / `INBOUND_SCAN_FEEDBACK_SECRET` via `readStringEnv` helper.
2. **Batch-approval flow** (PRs #468 / #469 / #475 / #476). Replaced the original "send immediately on triage" with a queue + daily prepare cron + dashboard click. Migrations v150–v154 added `clone_alert_notification_queue`, batch RPCs, FK to `brand_contact_directory.brand`. Send-route + record RPC look up the directory by `brand` PK (not `legitimate_domain` — was failing for brands like "Domain" whose name differs from its domain).
3. **Bank-channel routing** (PRs #482 + #486). NAB / Westpac / ANZ Bugcrowd VDPs explicitly reject phishing/clone reports (VDPs are scoped to software vulnerabilities). v155 re-routed the big-four to `fraud_inbox` with their real phishing inboxes; v156 silenced 13 brands with no acceptable inbox to `channel_type='none'`. Current directory: 42 manual_review, 41 fraud_inbox, 13 none, 9 contact_form, 1 security_txt, 0 bugcrowd_vdp.
4. **Silent-drop defence** (PR #487 + #488). A 2026-05-27 08:38 UTC Inngest cloud blip silently dropped the triaged event — `triage_at` was set in the DB but no batch appeared in approvals, looking exactly like "the click didn't work". Three defences: inline directory-lookup + `enqueue_clone_alert_notification` in the triage route (queue row exists by the time the dashboard returns); `inngest.send` with bounded retry (3 attempts, exponential 200/400/800ms backoff); on retry exhaustion, `sendAdminTelegramMessage` + `eventEmitted:false` in response so the dashboard surfaces a warning toast.
5. **Evidence in email** (PR #489). The prepare cron now fetches `urlscan_evidence` per alert in one batched query and the React Email template embeds the urlscan.io result link + screenshot thumbnail when retrieval succeeded. Template gracefully omits the evidence block when scan failed/timed out.
6. **Post-#489 hardening** (PR-A 2026-05-28). `RESEND_FROM_EMAIL` now read via `readStringEnv` at call-site (defeats trailing-whitespace + DefinePlugin static-inlining) in both the prepare cron auto-send path and the dashboard send route. Triage-route inline-enqueue path stamps `submitted_to.brand_notification` + logs cost telemetry for parity with the Inngest consumer. Dead `FROM_EMAIL` / `REPLY_TO_EMAIL` constants removed from `notify-brand.ts` (function no longer calls Resend).

**Open follow-ups** (filed during Phase E, not blocking):

- **#477** — `CRON_SECRET` raw `process.env.X` reads across 20+ files (mechanical trim PR).
- **#478** — Pre-filled Bugcrowd helper for the 9 remaining `manual_review` / `contact_form` brands.
- **#479** — Parallel takedown channels (Google Safe Browsing, PhishTank, APWG).
- **#480** — Time-to-takedown tracking by channel (Netcraft vs brand-direct).
- **#481** — Per-brand `auto_send` flag for trusted `fraud_inbox` brands (CBA, RBA, Aus Post).
- **#485** — Playwright form-POST automation for Scamwatch (replace PR #484's manual CSV upload).
