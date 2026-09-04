# Arthur's Take — Decisions

> Every deviation from the "Arthur's Take" brief (v0.1, 2026-09-04) with a one-line rationale,
> per the brief's own rule 7. Evidence for each is in [`DISCOVERY.md`](./DISCOVERY.md).
> Decisions marked **founder** were taken by Brendan on 2026-09-04.

---

## X1 — Two-stage generation, not a parallel pipeline

**Brief said:** a new `feed_item_takes` table, a second prompt over raw Reddit posts, lazy
generation on first detail-page view plus a nightly top-N batch.

**Decision:** extend the existing seam. **Stage 1** is the existing daily classifier, unchanged
except one new boolean `isScamReport`. **Stage 2** is a new "take writer" step inside the same
Inngest function that reads the **structured intel row plus the excerpt** and writes `take_tells[]`,
`take_where` and `take_au_line` back to `reddit_post_intel`.

**Why:** the alternative considered first was folding the take fields into the classifier prompt
(one call). Two-stage wins on every axis that matters and loses only on call count:

|                   | One prompt                                                                                                                | Two-stage (chosen)                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Prompt coupling   | Reader tone and intel extraction share a version; tuning wording re-opens the intel golden set and busts the prompt cache | Independent prompt, version and model                        |
| Regeneration      | Requires reclassifying, and the upsert is `ignoreDuplicates` so it never overwrites                                       | Regenerate takes over 4,313 existing rows for ~US$3 on Haiku |
| Truncation        | The batch already hit its 12k cap once; adding prose per post pushes it further                                           | Intel call untouched                                         |
| Failure isolation | A bad take schema fails the whole intel batch                                                                             | Take failure never touches intel                             |

It is still one seam: one table, one brake, one taxonomy, one retention policy, no new Inngest
function. North Star filter #3 is satisfied by extending `reddit_post_intel`, not by avoiding a
second call.

## X2 — Global scope with an AU line (founder)

**Brief implied:** an AU-first framing.

**Decision:** takes are written for every post regardless of country. `take_where` describes where
and how the pattern shows up globally; `take_au_line` is one sentence, present only when a genuine
Australian analogue exists. The feed's default ordering is untouched.

**Why:** founder — "new scams pop up all over the world and I would love to reference all so we can
keep ahead." The corpus is ~98% non-AU (87 of 4,313 posts carry an AU hint); an AU-only filter would
discard the early-warning value that is the point of watching r/Scams in the first place. The AU
angle is the _translation layer_, not the _filter_.

## X3 — No lazy generation, no LLM in the request path

**Brief said:** lazy generation on first detail-page view with an in-page "generating" state.

**Decision:** the detail page is a pure database read. Freshness comes from moving the trigger cron
to run an hour after each 6-hourly scrape (`0 1,7,13,19 * * *`) instead of once daily.

**Why:** a per-view Sonnet call adds latency, a new Inngest function competing for a 5-slot plan, and
a fresh cost surface — for content the batch already produces within hours at US$0.0045 a post.
The brief's own §7.6 ("generation runs in the background worker, never inline") points the same way.

## X4 — Store the full scrubbed body in `body_md` (founder)

**Decision:** the scraper writes the full username-scrubbed `selftext` to the existing
`feed_items.body_md` column (cap 20k chars); `description` remains the 500-char public excerpt. The
classifier reads `coalesce(body_md, description)`.

**Why:** 4,974 of 6,168 rows (81%) are truncated at exactly 500 characters, so today's intel — and
any take built on it — analyses only the first paragraph of a scam story. This improves the existing
product, not just this feature. Nothing additional is published; the change is what we hold
internally, so it needs a note in the privacy impact assessment.

## X5 — Skip `[removed]` / `[deleted]` posts at ingest (founder)

**Decision:** the scraper skips a post whose `selftext` is a tombstone string instead of storing it.

**Why:** there is no handling at all today; a tombstone would be stored verbatim and then analysed.
Cheap to prevent at the source. (Prod currently holds zero such rows — this is prophylactic.)

## X6 — Take-first cards (founder)

**Brief said:** Phase 4b adds a scam-type chip and confidence dot to existing cards.

**Decision:** when the take exists and the flag is on, the card **leads** with Arthur's paraphrase
and top tell; the Reddit excerpt becomes secondary; the card links to our detail page rather than
out to Reddit. Flag-off rendering is byte-identical to today.

**Why:** the brief's own problem statement is that the feed is verbatim reposts adding no Ask Arthur
value. A chip on an otherwise unchanged card does not fix that; leading with our analysis does. It
also sits _better_ with `docs/compliance/reddit-intel-reddit-tos.md`, which says our surfaces should
show the paraphrased narrative rather than the source body.

## X7 — Reuse the 15-label taxonomy plus an `is_scam_report` boolean

**Brief said:** a new 14-value closed taxonomy including `not_a_scam`.

**Decision:** keep `intent_label`'s existing 15 values (shared with `feed_items.category`, the brand
aggregation RPCs and the B2B API) and add a separate `is_scam_report` boolean rather than a 16th
label.

**Why:** a parallel taxonomy would need permanent syncing against a CHECK constraint, the feed
category enum and four other copies. The brief's `not_a_scam` need is a different question from
"what kind of scam" — a boolean expresses it without polluting the enum. (`informational` already
covers awareness posts.)

## X8 — Actions are curated, not generated

**Decision:** `take_actions` is not stored and not written by a model. It is derived at render time
from `intent_label` via a curated map in `apps/web/lib/arthurs-take/actions.ts` that reuses the
destination constants in `apps/web/lib/onward/destinations.ts` (Scamwatch / IDCARE / ReportCyber,
plus international equivalents where known).

**Why:** "what to do" is advice with legal and safety weight; it must be consistent, reviewable, and
changeable without a regeneration run. The LLM contributes only what genuinely needs the post — the
tells and the AU line. Destination URLs and phone numbers stay in one place, per CLAUDE.md's
onward-reporting rule.

## X9 — Consensus eval deferred; ground truth is human review

**Brief said (G3):** benchmark accuracy against Reddit thread consensus from top comments.

**Decision:** deferred to v2. Ground truth for Gate 3 is (a) an admin review queue writing to
`reddit_post_intel_reviews`, (b) a 47-item human-labelled golden set, (c) a public "Was this
useful?" signal into `analytics_events`.

**Why:** comments are not ingested and adding them is a new Reddit surface with a PIA amendment and
fresh ToS exposure — for a label the brief itself rates "High likelihood of being wrong" (R8). Human
review is a stronger signal and unblocks the same gate.

## X10 — Message Batches API for the backfill only

**Decision:** the live 6-hourly path stays synchronous. The one-off backfill uses the Batch API
(50% cost). The classifier call is written behind a single `classifyBatch()` boundary so batch can
be swapped in later without touching the surrounding logic.

**Why:** at US$4.85 a month the live saving is ~US$2/month against the cost of a submit → poll →
collect loop and per-`custom_id` error handling. The backfill (4,313 takes, plus optionally ~1,855
unclassified pre-May rows) is where latency is irrelevant and 50% is real money. The SDK in use
(`@anthropic-ai/sdk` 0.74.0) supports batches; nothing in the repo uses them today.

## X11 — Repair clustering before building "new this week" on it

**Decision:** the cluster repair is a prerequisite PR, not a follow-up.

**Why:** the theme seam the brief and the novelty ask would both build on is inert — 200 themes all
`signal_strength='weak'`, one theme holding 52% of all posts, zero themes born since July, and
`wow_delta_pct` non-null on zero rows while being served by the B2B API. Building an "emerging
scams" surface on that data would ship a confident wrong answer. The weekly synthesis' set-diff
novelty (already correct, already running, currently email-only) is the piece to activate first.

## X12 — Model choice stays Sonnet 4.6 until an eval says otherwise

**Decision:** the take writer uses Haiku 4.5. The classifier stays on Sonnet 4.6 pending a
golden-set comparison of Haiku 4.5 / Sonnet 4.6 / Sonnet 5; switch only at ≥95% label agreement.
If Sonnet 5 is adopted it gets a **new** `MODELS` key and new pricing constants — the existing
`SONNET_4_6` key is never re-pointed.

**Why:** rewriting structured fields into plain language is low-reasoning work that Haiku handles;
classification is the accuracy-critical step and there is no eval today to justify moving it.
Silently re-pointing a model key hides a pricing and behaviour change in a diff that looks like a
config tweak.
