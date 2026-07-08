# Arthur's Watch — consumer newsletter reshape + competitor-newsletter intelligence

> **Status:** PLAN (2026-07-08). Scope of the session that produced this doc was
> plan + ADR only — no code shipped. Extends
> [`weekly-intel-dynamic.md`](./weekly-intel-dynamic.md) (Track A/B shipped in
> PR #699 / v208) by answering its open question §5-Q2 (aperture) and adding a
> consumer-voice reshape (§5-Q3 is left as weekly-only).
>
> **Owner:** brendan · **New flags (all default OFF):**
> `FF_COMPETITOR_NEWSLETTER_INGEST` (Phase 1 gate exception),
> `FF_INTEL_COVERAGE_GAP_DIGEST` (Phase 2 operator digest),
> `FF_WEEKLY_APERTURE_BLEND` (Phase 3 public blend),
> `FF_ARTHURS_WATCH_VOICE` (Phase 4 consumer reshape).
>
> **Locked decisions (2026-07-08, from four forks put to brendan):**
>
> 1. Competitor newsletters feed the product **both** ways — a private
>    editorial coverage-gap digest **and** (once validated) a labelled blend
>    into the public "emerging this week" cohort.
> 2. "Arthur's Watch" is a **reshape of the existing Monday email**, not a
>    second newsletter. Existing `email_subscribers` become the consumer list.
> 3. Send stays **in-house on Resend + React Email** for now. Beehiiv is a
>    later, optional bridge (Phase 6), not this build.
> 4. This session: **plan + ADR only.**

---

## 0. Why

Two problems, one feature.

**Problem A — the newsletter's content aperture is too narrow.** Per
`weekly-intel-dynamic.md` §1c, 30-day `feed_items` volume is Reddit **1063** vs
everything-else `<20` (asic_investor 16, inbound_sans 9, verified_scam 8,
user_report 7, scamwatch 3, acsc 2). The Monday email is synthesised purely from
`reddit_post_intel`. A quiet Reddit week has nothing fresh to fall back on, and
we are blind to scams that surface first in regulator alerts or in the best
consumer scam newsletters (Which? Scam Alerts, AARP Fraud Watch).

**Problem B — the newsletter's voice and shape are B2B-editorial, not the warm
consumer register the brand owns.** The research (`launch-plan`, this session)
found a real, ownable gap: an Australian-origin, data-driven, _warm and human_
consumer scam early-warning weekly. Nobody owns it — government feeds (Scamwatch)
are institutional and campaign-paced; the strong independent fraud newsletters
(FrankonFraud, Risky Business) are B2B/practitioner-facing. Which? Scam Alerts
(UK) proves the consumer model scales to ~half a million free subscribers. Our
template (`WeeklyIntelDigest.tsx`) is already ~80% of the "Arthur's Watch"
anatomy — it just reads as a briefing, not as a smart friend.

The competitor-newsletter ingest solves **both**: subscribing Arthur's inbound
pipeline to the best consumer scam newsletters gives us (a) a fresh non-Reddit
signal stream to widen the aperture, and (b) a continuous read on what the market
leaders warn about, so our editor never misses a circulating scam.

---

## 1. What already exists (do not rebuild)

Confirmed by codebase survey 2026-07-08 (`file:line` throughout):

- **Inbound-email pipeline** — `<tag>+ingest@askarthur-inbound.com` → Cloudflare
  Email Routing → Worker (`apps/cloudflare-email-worker/src/index.ts`,
  `KNOWN_TAGS` lines 42-70) → Edge Function
  (`supabase/functions/intel-inbound-email/index.ts`) → `public.feed_items`.
  Battle-tested; adding a source is the `add-inbound-email-source` skill.
- **Embedding** — `feed-items-embed` Inngest cron Voyage-embeds new `feed_items`
  every 4h regardless of `published`.
- **Quarantine** — `/admin/inbound-quarantine` is a _view_ over
  `feed_items WHERE source LIKE 'inbound_%' AND published=false`, with manual
  admin **Promote/Delete** (`apps/web/app/admin/inbound-quarantine/actions.ts`).
- **Weekly synthesis** — `packages/scam-engine/src/reddit-intel/weekly-synthesis.ts`
  (`synthesizeWeeklyIntel`), persists to `reddit_intel_weekly_digest` (v208).
  Reads **only** `reddit_post_intel`.
- **Email seam** — `apps/web/lib/reddit-intel-weekly.ts` (`getWeeklyIntelForEmail`
  → `WeeklyRedditIntel` shape) → template `apps/web/emails/WeeklyIntelDigest.tsx`
  → `sendWeeklyIntelDigest` (`apps/web/lib/resend.ts`). Cron
  `apps/web/app/api/cron/weekly-email/route.ts`, `0 14 * * 1`.
- **Subscribers** — `email_subscribers` table + `/api/subscribe`; the weekly cron
  always includes operator `brendan.milton1211@gmail.com`.
- **Clone-watch readers** — `apps/web/lib/clone-watch/report-card-data.ts`,
  `feed-entity.ts` (source for a future "Clone Watch" section).

**Two blockers this plan must clear:**

1. **The tier_3 drop gate.** Since 2026-06-29 the Edge Function silently drops
   `tier_3_curated` sources at ingest (`intel-inbound-email/index.ts:212-215`) to
   keep the quarantine on-mission — built to reject security-press digests
   (Krebs, THN, Risky Biz). Consumer scam newsletters would hit the same gate. We
   must carve out a **distinct source class** the gate lets through.
2. **No `feed_items` → newsletter path.** `synthesizeWeeklyIntel` reads only
   `reddit_post_intel`. Folding any non-Reddit signal into the email is net-new.

---

## 2. Design

### 2a. The competitor-intelligence source class (clears blocker 1)

The named consumer scam newsletters are a **different kind of source** from both
regulators (tier_1/2, publishable) and security press (tier_3, dropped):

- They are **on-mission** (consumer scam awareness) → must _not_ be dropped.
- They are **third-party editorial content** → must _never_ be republished to the
  public `/scam-feed` (copyright + a trust brand cannot look like it's lifting a
  competitor's work). Intelligence only.

So they need to be ingested-but-quarantined-permanently and excluded from the
promote path. **Decision (see ADR-0021):** mark the ingested `feed_items` row
with a `competitor_intel` **category** (not a new provenance tier — provenance
stays honest at `tier_3_curated`), plus a small **slug allowlist**
(`COMPETITOR_INTEL_SOURCES`) that the Edge Function drop gate checks _before_ the
tier_3 drop. Rows land `published=false`, `category='competitor_intel'`, and:

- The **quarantine promote action** refuses `category='competitor_intel'` (guard
  in `actions.ts:promoteRow`) — they can never reach the public feed by accident.
- The **quarantine UI** hides them, or shows them in a separate read-only
  "Intelligence sources" tab (they're not a promote/delete backlog).
- They still get **embedded** (add slugs to `get_unembedded_narrative_feed_items`
  allowlist per the skill) so they're available to the synthesis cohort query.

Sources to subscribe (Phase 1), each a new `inbound_<tag>` via the
`add-inbound-email-source` skill:

| Newsletter                           | Tag            | Country | Notes                                         |
| ------------------------------------ | -------------- | ------- | --------------------------------------------- |
| Which? Scam Alerts                   | `which_scams`  | UK      | The benchmark. Weekly, has email signup.      |
| AARP Fraud Watch (Watchdog Alerts)   | `aarp_fraud`   | US      | Over-50s; email + SMS.                        |
| MoneySavingExpert weekly             | `mse`          | UK      | Scam section inside a high-trust money email. |
| FrankonFraud (archive / any revival) | `frankonfraud` | US      | Wound down weekly Dec 2025; monitor.          |

(Scamwatch is already ingested as a tier_1 regulator — keep it there, it's
publishable.) AU-origin consumer sources can be added later with the same skill
once we find ones with an email signup (§7 Q2).

### 2b. The `feed_items` → newsletter synthesis path (clears blocker 2)

Two consumers of the same new cohort query, built in order so we validate signal
quality privately before anything reaches subscribers.

**Weekly intelligence cohort** — a new reader (`apps/web/lib/intel/weekly-cohort.ts`,
or a helper in `weekly-synthesis.ts`) that pulls, for the last 7 days:

- competitor-intel `feed_items` (`category='competitor_intel'`), and
- the thin-but-fresh streams (regulator alerts, `user_report`, `verified_scam`).

Each row carries a `sourceLabel` + `sourceTier` so downstream can weight and
attribute honestly.

**Consumer 1 — Editorial coverage-gap digest (Phase 2, operator-private,
`FF_INTEL_COVERAGE_GAP_DIGEST`).** One weekly Sonnet call comparing "what the
consumer scam newsletters warned about this week" against "what Arthur's own
cohort (Reddit + user reports + verified scams) surfaced," returning the scams
competitors are covering that Arthur under-covered. Output → a **separate
operator email to brendan** (or an operator-only section appended to the debug
strip). Never public. This is the direct answer to "inbound those newsletters to
inform our own newsletter": it hands the human editor a weekly gap list.

**Consumer 2 — Aperture blend into the public synthesis (Phase 3,
`FF_WEEKLY_APERTURE_BLEND`).** Extend `synthesizeWeeklyIntel` to accept the
weekly cohort as **additional labelled observations** alongside the
`reddit_post_intel` rows, so "emerging this week" is no longer Reddit-only. The
engine already re-attaches deterministic counts and forbids the model inventing
statistics — we extend that contract (see §3 guardrails).

### 2c. The "Arthur's Watch" reshape (Phase 4, `FF_ARTHURS_WATCH_VOICE`)

Reshape the render seam (`WeeklyRedditIntel` + `WeeklyIntelDigest.tsx`) to the
warm consumer anatomy from the research. Current → target section mapping:

| Arthur's Watch section                 | Status today                           | Work                                                                                                     |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Arthur's hello (2-3 sentences)         | none                                   | net-new copy block (LLM-drafted from top story, or template)                                             |
| 🚨 Scam of the Week                    | `scamOfTheWeekQuote` + top story exist | re-frame + real-screenshot alt-text                                                                      |
| 👀 Spotted in the Wild                 | = "Emerging this week" list            | rename + warm rewrite                                                                                    |
| 🕵️ Clone Watch                         | clone-watch tables exist, not wired    | new reader from `clone-watch/report-card-data.ts`                                                        |
| 📬 Mailbag                             | no data source                         | **deferred to Phase 5** (needs curated reader submissions; `inbound_scan` is the nearest existing input) |
| ✅ One Thing To Do                     | none                                   | net-new: small rotating tip library, or LLM tip tied to top scam                                         |
| Sign-off + product CTA + referral P.S. | CTA exists                             | add anti-shame sign-off + referral ask                                                                   |

Voice work: rename "Weekly Intel" → "Arthur's Watch"; drop the "Brands
impersonated / By the numbers" B2B framing (or move to an operator-only strip);
second person, short sentences, no jargon; anti-shame register ("being scammed is
never your fault"). Accessibility per research §7 (≥16px body, single column,
live text not images-of-text, descriptive alt-text on screenshots, contrast
≥4.5:1, no red-on-black panic aesthetic) — the demographic skews 65+.

---

## 3. Compliance & trust guardrails (existential for a scam brand)

- **Never republish competitor content.** Competitor-intel `feed_items` are
  `published=false` forever and the promote action refuses them (§2a). Signal,
  not content.
- **Synthesis prompt contract.** When competitor rows enter the cohort (Phase 3),
  the system prompt must: (1) treat competitor text as _evidence a scam is
  circulating_, not copy to reproduce; (2) write every headline/narrative in
  Arthur's own words — no verbatim, no close paraphrase; (3) only surface a scam
  in the public email if it is **corroborated by Arthur's own data OR is a clearly
  real, AU-relevant scam** — don't launder an unverified competitor claim into an
  Arthur verdict. The existing "model ranks/writes prose but never invents a
  statistic" guardrail extends to "never invents a scam."
- **Attribution is internal only.** The coverage-gap digest may name sources to
  the operator; the public email never cites a competitor.
- **Spam Act 2003** — already honoured by the existing send (consent, sender ID,
  one-click unsubscribe). Unchanged.
- **Cost + brakes** — every new Sonnet call logs `cost_telemetry`
  (`feature='intel-coverage-gap'`, and the blended call reuses
  `reddit-intel-weekly-synthesis`) and checks the shared
  `feature_brakes.reddit_intel` / `REDDIT_INTEL_CAP_USD`, per the scam-engine
  reddit-intel pattern (direct insert + `isRedditIntelBraked()`).

---

## 4. Phasing (each flag-gated, independently shippable)

- **Phase 1 — Competitor-newsletter ingest.** `add-inbound-email-source` ×5 (new
  tags + a v209 migration extending the constraint / RPC / index allowlists + a
  `competitor_intel` category marker), `COMPETITOR_INTEL_SOURCES` gate exception
  in the Edge Function, promote-action guard, subscribe + confirm each source.
  Zero public exposure. Gate: `FF_COMPETITOR_NEWSLETTER_INGEST`.
- **Phase 2 — Coverage-gap operator digest.** New weekly cohort reader + operator
  Sonnet call + operator email. `FF_INTEL_COVERAGE_GAP_DIGEST`. Validates signal
  quality before any public blend. **Recommended first real deliverable** — it's
  the "inform our newsletter" ask and carries no consumer-facing risk.
- **Phase 3 — Public aperture blend.** Extend `synthesizeWeeklyIntel` to accept
  the labelled cohort; enforce the §3 prompt contract. `FF_WEEKLY_APERTURE_BLEND`.
- **Phase 4 — Arthur's Watch voice + sections.** Reshape seam + template; wire the
  Clone Watch reader; One Thing To Do; hello + sign-off + referral.
  `FF_ARTHURS_WATCH_VOICE`.
- **Phase 5 — Mailbag (deferred).** Needs a curated reader-submission source
  (`inbound_scan` is the nearest existing input). Backlog until 1-4 prove out.
- **Phase 6 — Beehiiv bridge (optional, later).** If growth/monetisation becomes
  the priority, generate content in-house (this pipeline) and push to Beehiiv via
  API for send + Recommendation Network/Boosts. Not this build; keeps the
  proprietary-data moat either way. See `launch-plan` research §5-§6.

**Recommended sequencing:** 1 → 2 → (4 voice, can run parallel to 3) → 3 → 5/6.
Phase 2 delivers value with zero consumer risk; Phase 4 improves every send
independent of the competitor blend.

---

## 5. Verification (per CLAUDE.md ship workflow)

- **Phase 1:** subscribe each source with `<tag>+ingest@askarthur-inbound.com`,
  confirm the double-opt-in link, then run the skill's verification SQL — expect a
  row with `source='inbound_<tag>'`, `category='competitor_intel'`,
  `published=false`, embedded within one cycle. Confirm the promote action refuses
  it. Re-run `get_advisors` after v209.
- **Phase 2:** dry-run the coverage-gap call against last 7d on a preview; eyeball
  that the gap list names real scams Arthur under-covered (not competitor noise).
  Confirm `cost_telemetry` row + brake check. Send to operator address only.
- **Phase 3:** run `synthesizeWeeklyIntel` with and without the blend on the same
  window; confirm blended stories are corroborated and in Arthur's voice (no
  verbatim). Subject-count still varies (`resend.ts:129`).
- **Phase 4:** render the reshaped template in dark mode + mobile + Gmail/Outlook/
  Apple Mail; alt-text present; single CTA; contrast ≥4.5:1.

## 6. ADR-worthy decisions

- **ADR-0021 (drafted this session):** the `competitor_intel` source class —
  ingest-but-never-publish, gate-exception, promote-refused. Hard to reverse
  (schema + gate + ops posture), surprising (a source deliberately quarantined
  forever), a real trade-off (vs a new provenance tier / vs not ingesting).
- **Aperture broadening** (Phase 3) revises `reddit-intel.md` D-decisions and
  answers `weekly-intel-dynamic.md` §5-Q2 — fold into that plan or a short ADR
  when built.
- The B2B→consumer voice change (Phase 4) is reversible (flag) and unsurprising
  given the research — a plan-level note is enough, no ADR needed.

## 7. Open questions for brendan

1. **Coverage-gap digest destination** — separate operator email, or an
   operator-only section stapled to the existing Monday debug strip?
   (Recommendation: separate email — different cadence/purpose, keeps the
   consumer send clean.)
2. **AU consumer sources** — Which?/AARP/MSE are UK/US. Worth hunting for an
   AU-origin consumer scam newsletter with an email signup for local relevance,
   or is the mechanic-is-universal framing (research §2) enough for v1?
   (Recommendation: launch with UK/US signal — the scams are the same — and add
   AU sources opportunistically.)
3. **One Thing To Do source** — a small hand-curated rotating tip library (safe,
   predictable), or LLM-generated per week tied to the top scam (fresher, needs a
   guardrail pass)? (Recommendation: curated library for v1.)
4. **Track C interaction** — Track C (clustering repair) is still open and
   independent. If Track C lands first, the theme table becomes trustworthy and
   the aperture blend (Phase 3) can also enrich the durable themes, not just the
   email. No dependency either way; noting the synergy.
