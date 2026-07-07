# Weekly Intel digest — making "emerging this week" actually dynamic

> **Status:** Track A + B BUILT 2026-07-07 (branch `reddit-intel/weekly-dynamic-digest`,
> flag OFF pending canary). Track C (clustering repair) still open — see §2 Track C.
> Read the Diagnosis before touching any surface; the fix is not where the symptom is.
>
> **Owner:** brendan · **Feature flags:** `FF_REDDIT_INTEL_EMAIL` (send) +
> `FF_REDDIT_INTEL_WEEKLY_SYNTHESIS` (Track B LLM path, default OFF — canary
> independently), plus the pipeline flags in `docs/plans/reddit-intel.md`.
>
> **What shipped (Track A + B):**
>
> - Migration **v208** `reddit_intel_weekly_digest` (applied to prod, service-role
>   only, default-empty → zero traffic until the flag flips).
> - Engine `packages/scam-engine/src/reddit-intel/weekly-synthesis.ts` —
>   deterministic cohort aggregation + first-seen-this-week novelty diff + one
>   Sonnet call → 3–5 ranked stories, get-or-create per week, cost_telemetry
>   (`feature='reddit-intel-weekly-synthesis'`) + shared `feature_brakes.reddit_intel`.
> - Email wiring `apps/web/lib/reddit-intel-weekly.ts` (`getWeeklyIntelForEmail`)
>   prefers synthesis; theme-table fallback now ranks by **members-added-this-week**
>   (Track A velocity). Template renders synthesis stories as plain headlines with a
>   "New this week"/"Rising" chip.
> - Platform reader `getLatestWeeklyIntelDigest()` in `apps/web/lib/reddit-intel.ts`
>   so the dashboard + a future B2B `/api/v1/intel/digest` consume the same object.
> - Unit test for the aggregation/novelty helper; fixtures updated.
>
> **To activate:** set `FF_REDDIT_INTEL_WEEKLY_SYNTHESIS=true` on Vercel, then hit
> the weekly-email cron on a preview to eyeball two consecutive weeks differ.
> **Still open:** Track C, and a B2B `/api/v1/intel/digest` endpoint (fast follow),
> and a `db.generated.ts` regen to include the new table (cosmetic — code uses `as` casts).

---

## 0. Symptom

The Monday "Ask Arthur Intel" email ([subject `[1 emerging scam in AU this week]`])
reads the same every week. Same subject count (`1`), same lead theme
("Social media platform scams targeting creators and sellers"), same shape. It
feels static / monthly, not weekly-fresh.

The email **is** reading live data — the problem is upstream. The data itself has
collapsed into a single point.

---

## 1. Diagnosis (evidence from prod `rquomhcgnodxzkhokwni`, 2026-07-07)

Three compounding failures, from worst to least:

### 1a. The clustering has a runaway attractor sink (root cause)

`reddit_intel_themes` has **160 active themes**, but only **16 are named**, and one
theme has eaten everything:

| theme                                                          | member_count | first_seen | last_seen                      |
| -------------------------------------------------------------- | ------------ | ---------- | ------------------------------ |
| **Social media platform scams targeting creators and sellers** | **2023**     | 2026-05-03 | 2026-07-05 (still growing)     |
| Celebrity impersonation romance scams…                         | 44           | 2026-05-01 | 2026-05-02 (frozen)            |
| Spoofed/manipulative phone contact…                            | 26           | 2026-05-01 | 2026-05-02 (frozen)            |
| …every other named theme                                       | ≤7           | 2026-05-01 | **2026-05-01/02 (all frozen)** |

**Of the last 14 days of classified posts, 503 of 503 landed in the one mega-theme.
Zero new themes formed.** Every other theme stopped growing on 2026-05-02.

Why: greedy assignment (`packages/scam-engine/src/inngest/reddit-intel-cluster.ts`)
joins a new post to the nearest theme centroid at cosine ≥ `0.62`, then updates that
centroid as an **online running mean**. Once a theme accumulates a few hundred
members its centroid drifts to a generic average of "a scam narrative," which then
sits within 0.62 of essentially every new post. It becomes an absorbing state: the
more it eats, the more generic (and thus more attractive) it gets. Classic greedy-
single-pass clustering collapse. The threshold history in the file header already
flagged "themes ballooning (>50 each — too loose)" as the failure mode to watch —
this is that failure, at 2023×.

### 1b. "Emerging" is ranked by all-time size, not weekly novelty

`apps/web/lib/reddit-intel-weekly.ts` builds `emergingThemes` by:
`is_active AND title <> 'Pending naming' AND last_seen_at >= now()-7d`, then
`ORDER BY member_count DESC LIMIT 5`.

Even with healthy clustering this rewards the **oldest, biggest** theme, not what is
new this week. Combined with 1a, only the mega-theme has a recent `last_seen_at`, so
the query returns exactly **one** row — hence the subject line is permanently
`[1 emerging scam…]` (subject count = `emergingThemes.length`,
`apps/web/lib/resend.ts:129`) and it is always the _same_ scam.

### 1c. Single narrow content aperture

30-day `feed_items` volume: reddit **1063**, asic_investor 16, inbound_sans 9,
verified_scam 8, user_report 7, scamwatch 3, acsc 2. Only Reddit narrative feeds the
theme pipeline. High-signal, inherently-fresh streams (regulator alerts, user
reports, verified scams) are not part of "emerging this week" — so a quiet Reddit
week has nothing fresh to fall back on. (Regulator alerts _are_ appended, but as a
static-feeling footer list, not as emerging signal.)

**Design principle that was violated:** _"emerging this week" must be a pure function
of this week's content._ Today it is a function of two-months-of-accumulated cluster
state. Fixing that principle is the whole job.

---

## 2. The plan — three tracks

Ordered by leverage. **Track A + B together give a dynamic email next week** and are
independent of the clustering repair. **Track C** repairs the durable theme store
that the dashboard and B2B `/api/v1/intel/*` also depend on. They can be built in
parallel by separate agents — A/B touch `apps/web/lib/*` + email; C touches
`packages/scam-engine/src/inngest/*`.

---

### Track A — Redefine "emerging" as this-week velocity (email selection layer)

**Goal:** stop ranking by cumulative `member_count`; rank by _members added this
week_, computed directly from the cohort, so the metric is dynamic by construction.

Weekly velocity per theme is derivable **without schema changes** — count the
posts that joined each theme in the window:

```sql
-- members added to each theme in the last 7 days
SELECT p.theme_id, count(*) AS members_added_7d
FROM reddit_post_intel p
WHERE p.processed_at >= now() - interval '7 days'
  AND p.theme_id IS NOT NULL
GROUP BY p.theme_id
ORDER BY members_added_7d DESC;
```

Rank `emergingThemes` by `members_added_7d` (velocity), not lifetime `member_count`.
Show "+N this week" in the email instead of the raw total.

**Caveat:** on its own, with the sink unresolved, this _still_ returns only the mega-
theme (it is the only theme gaining members). Track A is necessary but delivers its
payoff only once Track B or C provides more than one growing cluster. Ship it, but
don't expect it to move the needle alone.

Optional durability: add a lightweight `reddit_intel_theme_weekly (theme_id,
week_start, member_count_snapshot)` table written by the retention/cluster cron so WoW
deltas survive body-retention pruning. Not required for v1 — the live count query
above is enough.

---

### Track B — Weekly narrative synthesis over the cohort (recommended primary)

**This is the highest-leverage change and it is dynamic by construction.** Instead of
selecting from the (broken, all-time) theme table, generate the email's "emerging
this week" section from **this week's classified posts directly** via one Sonnet call
per week.

Input: the last 7 days of `reddit_post_intel` rows —
`narrative_summary, brands_impersonated, tactic_tags, novelty_signals, intent_label,
category` — plus the thin-but-fresh streams from 1c (regulator alerts, user reports,
verified scams).

Prompt: _"Here are this week's ~260 AU scam-narrative observations. Identify the 3–5
most significant scam stories **that are characteristic of or new to this week**.
Rank by a blend of volume and novelty (weight `novelty_signals` / first-seen
brands + tactics). For each: headline, 1–2 sentence narrative, representative brands,
example victim quote."_ Return structured JSON (Zod-validated, same pattern as the
existing naming call in `reddit-intel-cluster.ts`).

Why this works:

- Input = this week's content → output cannot be stale.
- Bypasses the clustering sink entirely; the durable theme table stays for the
  dashboard/B2B and can be repaired independently (Track C).
- The classifier already extracts `novelty_signals` per post — this consumes signal
  we currently throw away in the email.
- Cost: ~1 Sonnet call/week over ~260 short rows ≈ **cents/week**, well inside
  `REDDIT_INTEL_CAP_USD`. Log to `cost_telemetry` as
  `feature='reddit-intel-weekly-synthesis'`; reuse the `feature_brakes.reddit_intel`
  check.

Persist the synthesis to a `reddit_intel_weekly_digest (week_start, stories jsonb,
model_version, prompt_version, created_at)` row so the email render is a pure read
(idempotent re-sends, and a record of what shipped each week for honesty/audit —
mirrors the `monthly-linkedin-clone-watch-report` honesty guardrail).

Wire `getWeeklyRedditIntel()` to prefer this week's synthesis row for
`emergingThemes`; keep the theme-table path as fallback when synthesis is absent.

---

### Track C — Repair the clustering sink (durable theme store)

Needed so the **dashboard widget** and **B2B `/api/v1/intel/*`** (which read the theme
table directly, not the email synthesis) also become dynamic, and so long-run WoW
theme tracking is trustworthy. Independent of A/B.

Candidate fixes (a subset, tuned empirically — this is a re-tuning exercise, treat as
an ADR-worthy decision since D3/D4 in `reddit-intel.md` are being revised):

1. **Break the online-mean drift.** Assign by **max similarity to the theme's recent
   members** (k-NN over the last ~50 member embeddings) rather than to a drifting
   centroid mean. Absorbing-state behaviour comes from the mean; a recency-bounded
   k-NN can't generalise to "any scam."
2. **Recency-window the candidate themes.** Only consider themes with a member added
   in the last N days (e.g. 14) as join targets. Themes age out; genuinely new weekly
   narratives are forced to form fresh clusters → dynamic by construction.
3. **Cap + split runaway themes.** When `member_count` crosses a ceiling (e.g. 200),
   freeze the theme as a "macro-category" and re-cluster its _recent_ members into
   sub-themes. The existing mega-theme (2023 members) needs a one-off backfill split —
   it clearly contains distinct weekly sub-stories (TikTok PR-partnership, Facebook
   Marketplace/Zelle, art-commission, etc.).
4. **Reconsider embed text.** The composite `category|brands|tactic|narrative` string
   may be too generic (header comment already suspects this). Try narrative-only
   embeddings and re-tune the threshold.
5. **Re-tune threshold** (D3) against whichever of the above lands — likely upward
   from 0.62, or moot if switching to k-NN/recency-window.

Ship behind the existing pipeline flags; validate on a preview branch with the
`rpcs.smoke.test.ts` harness before flipping. Record the revised clustering decision
as a new ADR superseding the D3/D4 choices.

---

## 3. Recommended sequencing (two parallel agents)

- **Agent 1 (email/data — quick dynamic win):** Track B first (weekly synthesis +
  `reddit_intel_weekly_digest` table + wire into `getWeeklyRedditIntel` + email copy
  for "+N this week"), then fold in Track A velocity + Track 1c fresh-stream blend.
  Delivers a genuinely different email next Monday without waiting on C.
- **Agent 2 (pipeline — durable fix):** Track C. Longer, empirical, needs preview-
  branch tuning + ADR. No email dependency.

Both are flag-gated and independently shippable. Merge order doesn't matter.

## 4. Verification (per `CLAUDE.md` ship workflow)

- Track B: dry-run the synthesis against last 7d in a preview branch; eyeball that the
  3–5 stories differ week-over-week when run on two different windows. Confirm
  `cost_telemetry` row + brake check. Send a test digest to the operator address.
- Track C: on a Supabase preview branch, run the new assignment over the last 30d of
  embeddings; assert no single theme exceeds the cap and that ≥3 themes gain members
  in a given week. Run `rpcs.smoke.test.ts`. Re-run `get_advisors` before any flag
  flip (hot-table index rule for the theme store).
- Subject line: after Track A/B, confirm `emergingThemes.length` varies (subject count
  is derived from it, `apps/web/lib/resend.ts:129`).

## 5. Open questions for brendan

1. **Primary lever** — go with Track B (weekly LLM synthesis, dynamic-by-construction)
   as the email's source of truth, or invest first in Track C (repair clustering) and
   keep the email reading the theme table? (Recommendation: **B first** — fastest path
   to a dynamic email, and C can follow without blocking.)
2. **Aperture** — should "emerging this week" blend non-Reddit streams (regulator/user
   reports/verified scams) into the same ranked section, or keep them as a separate
   labelled block? (Recommendation: blend, labelled by source.)
3. **Cadence** — the feel-static complaint says "monthly." Keep weekly send but make it
   dynamic (this plan), or also add a monthly roll-up? (This plan assumes weekly.)
