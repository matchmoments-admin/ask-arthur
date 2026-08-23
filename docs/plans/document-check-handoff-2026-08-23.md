# Document Check — handoff, 2026-08-23

Written to end a long session cleanly. Read this first; it tells you what
exists, what's proven, what's still open, and the two traps that cost the
most time.

**Ops config:** [document-check-config.md](../ops/document-check-config.md) ·
**Billing:** [document-check-billing-config.md](../ops/document-check-billing-config.md) ·
**Vocabulary:** CONTEXT.md → **Finding**, **Registry Check**

---

## What this is

Deterministic PDF document forensics for AU scam documents — invoices,
payslips, bank letters, rental documents. Two layers:

- **Structural** (jurisdiction-agnostic): incremental-update history,
  trailer `/ID` divergence, `/Producer`//`/Creator` tells, date divergence,
  XMP edit history. Hand-rolled byte walk, no PDF library (parsers _repair_
  the anomalies we observe).
- **Content** (per-jurisdiction pack; AU only today): text extraction →
  printed ABNs → mod-89 checksum → live ABR register lookup.

Output is **named findings, never a verdict** — no score, no FAKE/GENUINE,
and the asymmetry rule ("no traces found ≠ real") is enforced by a
build-failing copy test.

Origin: AUSTRAC Operation Claw (19 Aug 2026). Consumer wedge = fake
invoices / payment redirection (A$16.2m/yr AU losses, no consumer tool
exists anywhere). B2B wedge = AU rental (Snug/2Apply collect payslips and
forensically check nothing). Banks are explicitly out of scope.

## Status: BUILD COMPLETE, fully dark, and proven end-to-end on preview

Merged to main: **#1028** (engine + consumer surface), **#1030** (AU pack),
**#1031** (evidence records + B2B API), **#1032** (scanner document mode),
**#1033** (Stripe doc-plan axis). Migrations **v281–v283** applied to prod.

**Not yet on main — branch `smoke/document-check-preview` (7 commits):**
the unpdf extraction fix, pack-agnostic registry checks + `case_ref`
(v283), B2B audit-trail retention, the rate-limit copy, and the ops docs.
**This branch must be PR'd and merged — the feature does not actually work
without it.**

Every flag is unset: `NEXT_PUBLIC_FF_DOCUMENT_CHECK`,
`FF_DOCUMENT_CHECK_RECORDS`, `FF_DOCUMENT_CHECK_V1_API`,
`FF_DOCUMENT_CHECK_BILLING`. Preview has the first two ON for testing.

### Verified working on a real deployment (2026-08-23)

Not "tests pass" — actually exercised against preview:

- clean invoice → text extracted, ABN verified live against ABR
  (`AUSTRAC…`/`AUSTRALIAN TAXATION OFFICE`), **zero findings**
- doctored invoice → `multiple_revisions` + `producer_design_tool` +
  `dates_differ`, producer read from the LATEST revision (anti-spoofing
  works on real bytes)
- evidence record written, `/document-check/[ref]` renders, unknown ref
  leaks nothing (70-char shell)
- rate limit fires on the 6th check with `Retry-After` matching the copy
- **a real user document** (founder's income statement) → both real ABNs
  resolved to real entity names

## The two traps that cost the most time

**1. Raw `pdfjs-dist` cannot run on Vercel — in either bundling mode.**
Text extraction returned null in EVERY deployed build while passing
locally, so the whole AU/ABN layer was silently inert and the surface
looked healthy. Externalised → `ReferenceError: DOMMatrix is not defined`;
bundled → `Cannot find module pdf.worker.mjs` (Vercel traces the static
import, not the dynamic worker one). Both degraded to `null` through our
own catch. **Fixed by switching to `unpdf`** (serverless pdfjs, no worker,
no canvas). Do NOT re-add `pdfjs-dist` to `serverExternalPackages`.

**2. This class of bug is invisible to tests, CI and code review.** 45
tests, five review rounds and green CI all passed while the feature was
half-dead, because the failure path returns null by design. **Only a
deployed smoke catches it** — which is why step 1 of the smoke set is "a
text PDF must not say 'no text could be read'". Treat a green suite as
necessary, never sufficient, for anything whose error path is a fallback.

## Cost (asked and answered)

**No paid vendor is on this path** — no Claude, no Hive, no Inngest, no
OCR. Per-scan cost is Vercel compute only: ~US$0.00003–0.0002 typical,
~0.018¢ at the pathological ceiling. Caps stop cost scaling with document
size or page count (10 MB / 5 s / 20 pages / 200K chars / 5 ABR lookups).
Roughly **10,000 free consumer scans ≈ US$1–2/month**, so there is no
cost-recovery argument for charging consumers, and the free check is the
Engine-1 corpus builder. Volume users are monetised via the org-metered
B2B plans instead. This changes the day OCR ships — that's the first real
per-scan vendor cost, and it should land on a paid tier, never silently on
the free path.

## What's next, in the order I'd do it

1. **PR + merge `smoke/document-check-preview`.** Nothing else matters
   until this lands; extraction is broken on main without it.
2. **Real-PDF corpus testing** — the one thing still unmeasured is the
   false-positive rate on genuine issuer output (Xero, MYOB, bank exports).
   Everything else was synthetic fixtures. Any finding on a legitimate
   document is a potential false accusation.
3. **BSB validation** — the highest-value unbuilt check. Fake invoices keep
   the real ABN and swap the account, so "claims CommBank, BSB belongs to
   another bank" is the payment-redirection kill-shot. Blocked on the
   AusPayNet directory ingest decision (free monthly CSV vs a static
   prefix table — do NOT hand-type a table, it risks exactly the false
   accusations the copy table exists to prevent).
4. **Activation** — the runbook in the ops config: pre-flight advisors +
   Disk-IO, flip `NEXT_PUBLIC_FF_DOCUMENT_CHECK`, redeploy (build-inlined),
   run the smoke set, then the records flag, then the v1 flag per pilot key.
5. **First pilot** — one AU property manager, provisioned with the manual
   SQL in the billing config. Needs no Stripe products.

## Open decisions for the founder

- **Re-render disclosure** (proposed, not built): when the producer is a
  known re-render tool (`Skia/PDF`, `Quartz PDFContext`, …), say so in the
  clean state — "this file was generated by print-to-PDF, so earlier
  history wouldn't appear here either way". Strictly more honest; small.
- **B2B dashboard** — a pilot currently gets raw JSON. Even VerifyPDF's
  US$15 tier ships a dashboard. Likely the biggest conversion blocker.
- **Evidence PDF export** — `/document-check/[ref]` renders in-browser but
  has no PDF download (image-check has one). Matters for filing evidence.
- **Batch upload** — the market processes applications in bundles.
- **Aggregate report** — Snappt's annual _State of Applicant Fraud Report_
  is the Teach-pillar analogue to the monthly clone-watch drop, and would
  run off this feature's own corpus.

## Architecture review — deferred, deliberately

Done: pack-agnostic registry checks (the DB column and shared type were
AU-shaped, which would have broken the "packs are data" promise at the
database). Deferred as equally cheap later: a `lib/org-billing.ts` seam
(the entitlement predicate is open-coded in three places, the jsonb record
hand-cast in four), a discriminated allowance result replacing the
`degraded` boolean, and a shared upload/response-envelope module for the
two routes. The review explicitly recommended AGAINST extracting the third
`mapStripeStatusTo*` copy (parameterising a 12-line switch is shallower
than the duplication) and against a pack registry while only one pack
exists.

## Storage posture (settled)

Document bytes exist only as an in-memory Buffer for the request and are
never written (ADR-0010). Extracted text is used by the ABN pack and
discarded — there is no text column. Records keep: check ref, SHA-256 hash,
finding names, a curated metadata summary, ABN register results,
`case_ref`. Retention differs by source — `web` keeps flagged checks only
(anonymous consumer, data minimisation); `api` keeps every check (the
paying org is the controller and is buying the audit trail). Founder
confirmed keeping both the hash and the ABN digits.
