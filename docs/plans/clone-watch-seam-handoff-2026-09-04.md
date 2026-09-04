# Clone Watch — report-card Seam + one-read pipeline: handoff (2026-09-04)

Continuation point for PR **#1079** (`clone-watch/report-card-seam`), which acts on
an architecture walk over the merged targeting feature. Read the **Open** section
first — three of the five items are things I could not close, not things I chose
to defer.

## Where everything is

| Thing                   | Where                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| The work                | branch `clone-watch/report-card-seam` → **PR #1079** (open, CI green, MERGEABLE/CLEAN)                      |
| Worktree (this machine) | `…/35a204dd-…/scratchpad/wt-fixes`, deps installed, tree clean                                              |
| Merged earlier today    | #1073, #1076, #1077 (targeting feature), #1078 (super-fund casing)                                          |
| Migration               | **v298 APPLIED to prod** — `clone_watch_report_summary.card_json` + `.campaigns`                            |
| Prod access             | `pnpm --filter @askarthur/web exec tsx scripts/_query.ts --sql "…"` (untracked helper in the MAIN checkout) |
| Plan                    | `~/.claude/plans/twinkly-squishing-falcon.md`                                                               |

Suite **1,527 passed**, typecheck clean, lint 0 errors.

## What #1079 changes, in one line each

1. **The internal digest reported seven lifecycle metrics as 0 by construction.** Its
   hand-rolled SELECT omitted `submitted_to` / `lifecycle_state` /
   `netcraft_declined_at` / `weaponised_at` / `first_seen_at`, then fed those rows to
   `aggregateClonesByDomain`, which reads exactly those fields. Not flag-gated —
   wrong in every digest ever sent. Now shares `CLONE_COHORT_SELECT` +
   `applyCohortRules`, both unconditionally.
2. **The card is a pure fold.** `report-card.ts` (`buildReportCard`,
   `buildTrendRows`) over `CardInputs`; `report-card-data.ts` is the four reads and
   nothing else. The ladder is `pickSpotlight` in `spotlight.ts`.
3. **An edition is computed ONCE** and pinned (`card_json` + `out/card.json`),
   instead of 3–5 reads of a table the reconciler mutates daily, spread across an
   unbounded approval gate.
4. **No `lib/` Module imports from `app/api/inngest` any more** — which dissolves the
   cycle that was dictating Inngest topology.
5. **Slide 7 overflow fixed** — see below; this is what has blocked the August edition.

## The thing that matters most right now

**The August edition was never published.** The monthly lane has been RED since
2026-09-02:

    report-card export failed: slide 7 content overflows the 1350px frame
    (scrollHeight 1397) — the PDF would clip

The export's height guard did its job and nothing downstream ran. (It said "slide 6"
on 2 September — same component, renumbered to 7 when #1076 inserted the naming
slide.) Fixed in two cuts, and **measured, not assumed**:

|                                   | scrollHeight                    |
| --------------------------------- | ------------------------------- |
| before                            | 1397                            |
| after cut 1 (margins 24/20/16/16) | **1361** — still 11px over      |
| after cut 2 (margins 14/14/12/12) | fits; all 8 slides + PDF render |

The first commit's message claimed "verified by rendering" before it had been. It
had not. The second commit corrects that and records the real number. **If you take
one process lesson from this handoff: the guard reports the overrun but not the
margin of the fix, so a spacing change is not done until you have re-rendered.**

Rendering against a PR preview needs a token — Vercel Deployment Protection answers
an unauthenticated request with an SSO redirect, which the export reports as
"slide 1 did not render". `clone-watch-report-export.ts` now forwards
`VERCEL_OIDC_TOKEN` as `x-vercel-trusted-oidc-idp-token`. To re-measure:

```bash
cd apps/web   # MAIN checkout (has puppeteer + a linked project)
vercel env pull /tmp/.p --environment=production
vercel env pull /tmp/.d --environment=development --yes
export ADMIN_SECRET=…   # from /tmp/.p
export VERCEL_OIDC_TOKEN=…   # from /tmp/.d   (short-lived; never commit)
cd <worktree>/apps/web && pnpm exec tsx scripts/clone-watch-report-export.ts \
  --base=<PR preview URL> --month=2026-08 --out=/tmp/slides
```

Match the preview to the PR head by deployment id: `gh pr view 1079 --json
statusCheckRollup` gives `dpl_…`, and `vercel inspect <url>` prints the same id.
Three previews were live at once and only one was the head.

Also fixed on that slide: **"~50 major Australian brands"** was still hardcoded while
the watchlist holds 293 — a six-fold understatement of our own coverage, in the deck
sent to brands. It now reads `card.watchlistSize` (the count monitored for the WHOLE
reported month, so re-exporting a past edition states what was true then). Verified
in the render: the slide now says "290+".

## Open — in order

1. **The `/code-review` of #1079 never ran.** Three attempts, all killed by session
   rate limits (the last two mid-flight). Nothing from it landed. This is the same
   gap the previous handoff carried, and last time the re-run found 12 confirmed
   findings including a gate that failed open. **Re-run it before merging.** Focus:
   the `report-card-data.ts` → `report-card.ts` split (did any behaviour move?), the
   `pickSpotlight` extraction, and the digest's now-unconditional cohort rules.

2. **Merge #1079**, then **re-run the August edition**:
   `gh workflow run clone-watch-linkedin.yml -f month=2026-08`. `prepare` builds and
   pings Telegram; `publish` waits on the environment approval, so this cannot post
   by itself. The edition is a month overdue.

3. **`?pinned=1` has not been independently proven to serve the pin.** The preview
   render used it and the numbers were right — but a pinned card and a live card are
   _identical by design_ for August, so that render cannot distinguish them. To prove
   it: mutate `card_json` for a test month (e.g. bump `total`), render `?pinned=1`,
   and confirm the slide shows the mutated value; then restore. Until then the
   pinning is believed-correct, not demonstrated.

4. **The internal digest's corrected numbers have never been observed.** #1079
   deliberately changes its output — seven metrics move off zero, and with
   `FF_ADMIN_CLONE_SUMMARY_DIGEST` OFF it also stops counting confirmed false
   positives. Watch the next monthly digest, or trigger it, and sanity-check the
   lifecycle counts against `clone_watch_monthly_brand_stats`.

5. **The soak (#1068)** is still outstanding from the previous handoff: 2–3 days of
   zero `inngest/function.cancelled`, preclassify residue 0, cost rows ==
   classifications, first witnessed takedown (none since Aug 19 — escalate if still
   none).

## Verified, so you don't re-check it

- All 8 slides render + PDF builds against the PR-head preview (2026-09-04).
- Behaviour preservation, measured with `--no-write` BEFORE any write: the refactored
  code computes 2026-08 as **1032 detected / 153 brands / spotlight
  `mover bonds.com.au 16→28 delta 12 auRank 3` / watchlist 293 / mom priorTotal 1064**
  — identical to the persisted row in every field.
- After the write: `card_json` + `campaigns` (campaignCount 61) populated,
  `published_post_urn` still null, `generated_at` now set, and
  `clone_watch_monthly_brand_stats` still reconciles at **153 / 1032 / 887**.
- v298 applied; `mcp__supabase__get_advisors` → security 0 ERRORs, performance 0 ERRORs.
- `grep -rn 'from "@/app/api/inngest' apps/web/lib/` → nothing.
- Alert #3713 recovered; the `lost_weaponised` worklist reads 0.
- Public `/clone-watch` shows the corrected `median 23h`.

## Traps this session added to the pile

- **A monthly lane fails silently for a month.** The 2 September failure sat unnoticed
  until I ran the workflow by hand. Nothing pages on a red scheduled run. Worth a
  Telegram ping on `prepare` failure — the lane already has one for `publish`.
- **`SlideActed` is the slide that overflows**, because it is the only one whose block
  count varies with the data (the outcomes block appears, `unresolved` hides at zero).
  It now has ~13px of headroom, which one more sentence would consume.
- **Inngest serialises step returns**, so `CardInputs` (thousands of rows) cannot cross
  a step boundary — that is why the cron does load + both folds + both writes in ONE
  step rather than the obvious three.
- **A re-export of a past month must state what was true THEN.** Two claims already
  broke this rule by reading today's watchlist (the caption, fixed in #1076; the slide,
  fixed here).
