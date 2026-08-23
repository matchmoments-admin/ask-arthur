# Document Check — ops config

Deterministic PDF document forensics: structural editing traces + the AU
content pack (ABN checksum → ABR register). Consumer surfaces are free and
LLM-free; the B2B surface is org-metered. Billing config lives separately in
[document-check-billing-config.md](./document-check-billing-config.md).

Engine: `packages/scam-engine/src/document-check/` (seam: `inspectDocument`).
Session handoff + priorities:
[document-check-handoff-2026-08-23.md](../plans/document-check-handoff-2026-08-23.md).
Vocabulary: CONTEXT.md → **Finding**, **Registry Check**.

## Surfaces

| Surface          | Route / entry                                                | Auth   |
| ---------------- | ------------------------------------------------------------ | ------ |
| Standalone page  | `/document-check`                                            | open   |
| Homepage scanner | ScamChecker drawer row + PDF drag-drop → same API            | open   |
| API              | `POST /api/document-check` (multipart, `surface=web│inline`) | open   |
| Evidence page    | `/document-check/[ref]` (DC- ref)                            | open   |
| B2B              | `GET/POST /api/v1/document-checks`                           | apikey |

## Flags

| Flag                            | Default | Gates                                                                  |
| ------------------------------- | ------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_DOCUMENT_CHECK` | OFF     | Page + scanner mode + `/api/document-check` (build-inlined → redeploy) |
| `FF_DOCUMENT_CHECK_RECORDS`     | OFF     | DC- evidence records (v281) + `/document-check/[ref]`                  |
| `FF_DOCUMENT_CHECK_V1_API`      | OFF     | The keyed B2B surface                                                  |
| `FF_DOCUMENT_CHECK_BILLING`     | OFF     | Self-serve Stripe checkout (see billing config)                        |

`ABN_LOOKUP_GUID` (already present, shared with shop-check) is required for
ABR verification; without it every ABN reports `unverified` — never a finding.

## Caps & cost

**No paid vendor is on this path** — no Claude, no Hive, no Inngest. Per-scan
cost is Vercel compute only (~US$0.00003–0.0002 typical; the pathological
ceiling is one 5s CPU burn ≈ 0.018¢), plus a handful of Upstash commands and,
for flagged checks, one ~1–2KB Supabase row.

Bounded by construction — cost cannot scale with document size or page count
beyond these caps:

| Cap                     | Value                               | Where                                     |
| ----------------------- | ----------------------------------- | ----------------------------------------- |
| Upload size             | 10 MB                               | `DOCUMENT_CHECK_MAX_UPLOAD_BYTES` (types) |
| Text-extraction timeout | 5 s (task destroyed)                | `pdf-text.ts`                             |
| Pages extracted         | 20                                  | `pdf-text.ts`                             |
| Characters extracted    | 200,000                             | `pdf-text.ts`                             |
| ABR lookups per doc     | 5 (parallel, 4 s deadline each)     | `packs/au.ts`                             |
| Structural scan bytes   | 25 MB                               | `pdf-forensics.ts`                        |
| Free-surface rate limit | 5/hour per IP (fail-closed in prod) | `checkDocumentUploadRateLimit`            |
| B2B quota               | per-org calendar month, fail-closed | `v1-quota.ts`                             |

**Brake:** `feature_brakes.document_check` → skips ABR lookups (checksum
still runs, results report `unverified`). Registered in `KNOWN_BRAKE_KEYS`.

## Telemetry

- `cost_telemetry` `feature='document_check'`:
  - `provider='internal'`, `$0`, one row per scan — `metadata.surface` is
    `document_check_web` │ `document_check_inline` │ `document_check_api`.
  - `provider='abr'`, `$0`, one row per **real** upstream ABR call (cache
    hits carry `cached:true` and are deliberately not logged).
  - Volume is the point: $0 rows keep usage and the ABR ceiling visible in
    `/admin/costs` and the weekly digest before any spend exists.
- `analytics_events.document_check_completed` — attribution-gated funnel
  signal (findings count, signal names, surface). The `cost_telemetry` row is
  the cookie-independent floor.
- Axiom (error/warn always ship, no sampling):
  - `Document check error` / `v1 document-check error` — route threw.
  - `Failed to store document check record` — evidence write failed.
  - `extractPdfText: extraction unavailable` — **a spike here means the
    pdfjs bundle broke** (see below); occasional hits are just scanned PDFs.

## Activation runbook

1. Pre-flight: advisors (security + performance) + the Disk-IO query;
   `ABN_LOOKUP_GUID` present; no stale `feature_brakes.document_check` row.
2. `NEXT_PUBLIC_FF_DOCUMENT_CHECK=true` (Preview → Production) **and
   redeploy** — the flag is build-inlined; an env change alone does nothing.
3. Run the smoke set below.
4. `FF_DOCUMENT_CHECK_RECORDS=true` once the check surface is stable.
5. `FF_DOCUMENT_CHECK_V1_API=true` only when a pilot key is provisioned
   (scope `allowed_endpoints` to `document-checks` and/or
   `document-checks.submit`).
6. Rollback levers, most-specific first: v1 → records → route flag.

## Smoke set (run against a real deployment, not local dev)

Local dev **cannot** validate item 1 — the failure mode is bundler-specific.

1. **Text extraction works in the deployed bundle.** Upload any text-based
   PDF: the result must NOT say "No text could be read from this file", and
   an invoice carrying an ABN must resolve it to an entity name.
   **History worth knowing before you touch `pdf-text.ts`:** raw
   `pdfjs-dist` could not load on this runtime in EITHER bundling mode —
   externalised it threw `DOMMatrix is not defined`, bundled it failed
   worker resolution — and both degraded to null through our own catch, so
   the surface looked perfectly healthy while the entire AU/ABN layer did
   nothing. That is why extraction goes through `unpdf` (serverless pdfjs,
   no worker, no canvas) and why `pdfjs-dist` must NOT be re-added to
   `serverExternalPackages`. Verified on a preview deployment 2026-08-23.
   This failure mode is invisible to unit tests and CI — only a deployed
   smoke catches it, which is why it is step 1.
2. **Negative controls (the false-positive check).** Genuine invoices/payslips
   from real issuers (Xero, MYOB, bank statement exports) should mostly return
   "No editing traces found". Any finding on a legitimate document is a
   potential false accusation — tune before activating further.
3. **Positive control.** Open a legitimate PDF in Preview/Acrobat, annotate,
   save. Expect `multiple_revisions` (+ usually `dates_differ`).
4. **Design-tool tell.** A Canva export should trip `producer_design_tool`.
5. **ABN path.** An invoice with a real ABN should read "registered — <entity>".
   "Could not be checked" means the ABR path is unavailable in that env.
6. **Limits.** A >4.5 MB PDF must reach the handler (not a platform 413); the
   6th check in an hour from one IP must 429.
7. **Evidence (records flag on).** A flagged check returns a `DC-` ref and
   `/document-check/[ref]` renders it; a malformed ref 404s identically.

## What the structural layer can and cannot see

**Re-rendering erases history — this is inherent, not a bug.** Two things
are both called "editing":

- **Incremental save** (Acrobat, macOS Preview annotate-and-save) _appends_
  to the existing file. The original bytes remain, a revision is added, and
  we read the trail. This is what `multiple_revisions` detects.
- **Re-render** (print-to-PDF, "Save As", export from a web portal, most
  online converters) manufactures a **brand-new single-revision file**. No
  prior history exists in it, so a document edited and _then_ re-rendered
  is structurally indistinguishable from a freshly-issued one.

Consequence for the threat model: a payslip doctored in Photoshop and then
printed to PDF has a spotless structural record. That is precisely why the
clean-state copy says "no editing traces found, not that the document is
real", and why the **content layer carries the weight for the B2B use
case** — register checks interrogate the document's _claims_, which survive
re-rendering, rather than the file's history, which does not.

Recognisable re-render producers seen in the wild: `Skia/PDF` (Chrome
print-to-PDF, often with a full user-agent in `/Creator`), `Quartz
PDFContext` (macOS print), `Microsoft Print to PDF`, `wkhtmltopdf`,
Ghostscript. None of these is a finding — printing to PDF is completely
normal — but they explain why a clean result on such a file proves even
less than usual. Surfacing that explicitly in the clean state is a
proposed, not-yet-built improvement.

## Free-tier rate limit

5 checks per IP per hour (`DOCUMENT_UPLOAD_LIMIT_PER_HOUR`, exported from
`packages/utils/src/rate-limit.ts` and used by BOTH the limiter and the
user-facing copy so the stated allowance cannot drift from the enforced
one). The 429 states the allowance and the wait, and points at `/contact` —
NOT at a checkout, because self-serve billing is dark; the copy test bans
buy/upgrade/subscribe/pricing in that CTA. Update it when billing goes live.

**Preview and production share one Upstash instance**, so smoke-testing
from your own IP consumes the same window a real user (or you) would use.
To clear it: delete keys matching `askarthur:doc-upload*` via the Upstash
REST API.

## Known gaps (deliberate)

- **Scanned / photographed documents** — no OCR. Text extraction returns null
  and the content layer honestly reports "not assessed". Adding OCR introduces
  the first real per-scan vendor cost, so it should land on a paid tier, never
  silently on the free path.
- **BSB validation** — not built; awaits the AusPayNet directory ingest
  decision. This is the payment-redirection kill-shot (fake invoices keep the
  real ABN and swap the account), so it is the highest-value next check.
- **Arithmetic / YTD consistency** — needs layout-aware extraction.
- **Evidence PDF export** — `/document-check/[ref]` has no PDF download
  (image-check does). Matters for pilots filing evidence.
- **`doc_type`** — column exists but is always written null; records can't yet
  be filtered by invoice/payslip/statement.
