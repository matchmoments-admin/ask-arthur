# Clone-watch end-to-end review fixes (2026-09-23)

Source: three read-only reviews after PRs #1176–#1185 (live ops, code, brand-facing
data). Three PRs, ordered by urgency.

## PR A — honesty + false pages (urgent: before the 22:00 UTC digest and before

## approving the August brand reports)

- Health digest fetched ONE 72 h window, so weekly/monthly Lanes (report-summary,
  stewardship, fp-cluster) read "absent" most days. `laneFetchPlan()` derives a
  second, wide window from each shape's `expectEvery`; pinned by test.
- Brake evaluated before absence (a braked Lane writes no row); `enabled()` gates
  on every flagged roster Lane.
- Squatting table: a known `unknown` never falls back to neutral→"Live site"; a
  registry hold beats weaponised ("Suspended (was phishing)"); every status
  defined; statuses dated ("snapshot taken …"); abuse emails validated before
  `mailto:`.
- Public copy: "time-to-takedown / from report to removal" → "time to blocklisting
  (Netcraft classification)", withheld below the median floor; vendor-gap leg +
  weekly digest wording; "human reviewer confirms" and "~50 brands" corrected
  (293 covered); email no longer says "now serving" or "reported on your behalf"
  for every domain. Guarded by `cloneWatchPublicCopy.test.ts`.
- One `.au` coverage sentence (`components/clone-watch/CoverageNote.tsx`) on the
  index, method, monthly edition, share page and brand email (#772).

## PR B — correctness (agent; required before any enforcement flag goes on)

v320 projection safe casts + array registrar + re-emergence raises confidence
back; DNS: ENODATA ≠ gone, precheck skips names with no A/AAAA, re-emergence
requires A/AAAA; onward event ids + queued re-check + cap fail-closed + cap
counts the right features; worklist read errors are Lane errors; `unchanged_reads`
idempotent; stewardship accepts `YYYY-MM`.

## PR C — one first-party URL check everywhere + cleanup (agent)

Extension url-check (and analyze-ad) through the first-party module; stale docs
for the deleted submit-netcraft lane; inngest-brakes / background-workers drift;
stale comments; roster test checks absence-watch lanes.
