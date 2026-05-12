# Contact Form Upgrade + Analysis-Result Onward Reporting

> **Status:** historical narrative kept for legibility. Onward-reporting flow now lives at [docs/system-map/data-flows.md#6-onward-reporting-to-regulators](../system-map/data-flows.md#6-onward-reporting-to-regulators). For follow-up work, run `/to-prd` then `/to-issues` (artefact home is GitHub Issues — see `docs/agents/issue-tracker.md`).

**Status:** in-progress (branch `feedback/contact-form-and-onward-reporting`).
**Scope:** three workstreams — (A) /contact form augmentation with Notion+Telegram pipeline, (B) analysis-result onward reporting (brand-abuse email + destination picker), (C) passive trust signals (TrustBox footer + B2B review profiles + public accuracy page).

This plan supersedes the two research blocks shared in chat. Where the research diverges from the actual codebase, the codebase wins; deltas are noted inline.

---

## 1. Why

Two product needs converged:

1. **Contact form is one-shape** today (`/contact` → leads pipeline → Resend + Telegram admin). It collects sales enquiries but has no surface for bugs, improvements, or feature requests from real users. The research block proposed a Notion+Telegram bug pipeline; we're folding it in as an _augmentation_ of /contact (one entry point, dual destinations) so the leads pipeline keeps working.

2. **Analysis result screen ends at "we found a scam"** — there's no onward path. The "Report this scam" button on `ResultActionButtons.tsx` currently just adds the entities to Ask Arthur's threat feed; users have no way to forward evidence to Scamwatch, ReportCyber, IDCARE, or the impersonated brand. `known_brands` (v49) and `brand_impersonation_alerts` (v49) were created for this and have been sitting unused. We're activating both.

Underpinning both: trust is bidirectional and earned. We don't solicit reviews via qualified-moment CTAs (it's selection-bias funnel-gaming and corrodes the brand). We invest the trust budget in onward-reporting precision and a public accuracy page sourced from `verdict_feedback`.

## 2. What's already in place (audit confirmed)

- **`verdict_feedback` (v47 + v66 + v67)** — full schema: reason_codes, training_consent, wants_followup, followup_email + CHECK constraint, scam_report_id FK, analysis_id, locale, user_agent_family. Nothing to add.
- **`ResultFeedback.tsx`** — thumbs + progressive disclosure + reason chips + training consent + textarea. Posts to `/api/feedback`. No change needed.
- **`ResultActionButtons.tsx`** — Check something else / Report this scam buttons + inline confirmation. Currently fires `onReport` callback (which routes to threat-feed contribution). We rewire to open the new picker instead.
- **`InvalidSubmissionState.tsx`** — blue info panel + IDCARE escalation. No change needed.
- **`AnalysisProgress.tsx`** — 4-step honest progress component already exists. No change needed.
- **`known_brands` (v49)** — 11 brands seeded with `security_contact_email` + `security_contact_url`. We extend the schema and seed ~14 more.
- **`brand_impersonation_alerts` (v49)** — pipeline scaffold with `outreach_status` (pending/drafted/sent/responded). We light it up.
- **`/api/leads`** — Resend + Telegram admin already wired. We dual-write to Notion when type ∈ {bug, improvement, feature}.
- **Notion client** — not installed. We add `@notionhq/client`.

## 3. Workstream A — /contact augmentation

### A.1 Form (UX)

Type radio at top of `ContactForm.tsx`:

- **General enquiry** (default; preserves existing behavior)
- **Bug report** — additional fields: `steps_to_reproduce`, `severity` (Blocker/Critical/Major/Minor), optional screenshot
- **Improvement** — additional fields: `current_behavior`, `desired_behavior`
- **Feature request** — additional fields: `problem`, `use_case`

Auto-attached on submit (silent): `url`, `userAgent`, `viewport`, `appVersion`, `timestamp`, `locale`. No screenshot upload in P1 — defer to P2.

### A.2 Pipeline

`/api/leads` (kept, not renamed) does dual-write:

1. **Always** — existing leads insert + Resend email + Telegram admin (unchanged).
2. **If type ∈ {bug, improvement, feature}** — additionally call `notion.pages.create()` against the new "Feedback Tracker" Notion DB. Non-blocking; failures log but don't 500.

Telegram message format unchanged for `general`. For typed feedback, post a structured HTML message (per research block — HTML over MarkdownV2's 18 reserved chars) with emoji, type, title, description preview, reporter, URL, "Open in Notion" deep-link.

### A.3 Notion DB schema (created manually in UI before deploy)

Properties:

- `Title` (title), `ID` (unique_id, prefix `FB-`), `Type` (select: Bug/Improvement/Feature), `Status` (status: New → Triaged → In Dev → In Review → Shipped/Won't Fix/Duplicate — set up in UI; API can't create custom status options), `Priority` (select: P0–P3), `Severity`, `Reporter` (email), `Description` (rich_text), `Steps`/`Current`/`Desired`/`Problem`/`Use Case` (rich_text), `URL`, `Browser/OS`, `App Version`, `Submitted At` (date), `Source` (select: web/extension/mobile).

### A.4 Files

**New**

- `apps/web/lib/notion/client.ts` — Notion SDK wrapper.
- `apps/web/lib/notion/feedback-tracker.ts` — `createFeedbackPage(payload)` builder.

**Modify**

- `apps/web/app/contact/ContactForm.tsx` — type selector + conditional fields + auto-attach metadata.
- `apps/web/app/api/leads/route.ts` — dual-write logic, structured Telegram for typed feedback.
- `apps/web/package.json` — add `@notionhq/client`.

**Env vars (Vercel)**

- `NOTION_TOKEN` — **reuse the existing agent-fleet integration token**. The agent-fleet Cloudflare Worker has `NOTION_TOKEN` set as a secret (used for blog/social/investor/competitor/digests DBs in the same Notion workspace). Copy that value into Vercel for safeverify; same integration just needs the new Feedback Tracker DB connected via "Add connection" in the Notion UI.
- `NOTION_FEEDBACK_DB_ID` — DB id of the new "Feedback Tracker" DB (created in same Notion workspace).
- `TELEGRAM_FEEDBACK_CHAT_ID` _(optional; falls back to TELEGRAM_ADMIN_CHAT_ID)_

## 4. Workstream B — Analysis-result onward reporting

### B.1 Schema (single migration v119)

Idempotent migration covering:

**Extend `known_brands`**

```sql
ALTER TABLE public.known_brands
  ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'email'
    CHECK (contact_type IN ('email','webform','inproduct')),
  ADD COLUMN IF NOT EXISTS evidence_format TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes TEXT;
```

Seed additional brands (Apple, PayPal, Microsoft, eBay, Netflix, LinkedIn, Binance, Coinbase, Meta-as-webform, Google-as-webform). `phish@fb.com` explicitly NOT seeded — Meta is `contact_type='webform'` per research block (deprecated address).

**New `onward_report_log`**

```sql
CREATE TYPE public.onward_destination AS ENUM (
  'scamwatch','reportcyber','acma_email_spam','idcare','brand_abuse','ask_arthur_feed'
);
CREATE TYPE public.onward_status AS ENUM (
  'queued','sending','sent','delivered','failed','skipped'
);
CREATE TABLE public.onward_report_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scam_report_id BIGINT REFERENCES public.scam_reports(id) ON DELETE CASCADE,
  analysis_id TEXT,
  destination public.onward_destination NOT NULL,
  destination_key TEXT,
  status public.onward_status NOT NULL DEFAULT 'queued',
  status_reason TEXT,
  provider TEXT,
  provider_message_id TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  payload_hash TEXT,
  retention_expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 months'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- + indexes + RLS service-role-only + dedup unique index
```

**New RPC `get_onward_destinations`**
Returns dynamic destination list given (scam_type, impersonated_brand, channel, has_financial_loss, has_pii_compromise). Uses `#variable_conflict use_column` per CLAUDE.md PL/pgSQL gotcha.

### B.2 API routes

- `apps/web/app/api/report/destinations/route.ts` — GET, calls RPC.
- `apps/web/app/api/report/onward/route.ts` — POST, validates, inserts `onward_report_log` rows in `queued` status, fires Inngest events, returns `results[]`.

### B.3 Inngest workers (`packages/scam-engine/src/inngest/functions/onward/`)

| Function                        | Behavior                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-onward-brand-abuse`     | Resend send to `known_brands.security_contact_email`. Rate-limited 30/h per brand. **Manual-review gate**: first 10 sends to any new brand_key require admin approval (status `queued` + admin alert; `sent` only after click-through). Updates `brand_impersonation_alerts.outreach_status`. Retries=4. |
| `report-onward-acma-email-spam` | Resend send to `report@submit.spam.acma.gov.au`. P1 ships text body; `.eml` attachment deferred to P2.                                                                                                                                                                                                   |
| `report-onward-scamwatch`       | Marks `skipped` with `status_reason='no_api_user_redirect_required'`. UI surfaces deep-link + clipboard-prefilled evidence block.                                                                                                                                                                        |
| `report-onward-reportcyber`     | Same skipped pattern + deep-link.                                                                                                                                                                                                                                                                        |
| `report-onward-idcare`          | Same skipped pattern + phone 1800 595 160.                                                                                                                                                                                                                                                               |

### B.4 React Email templates

- `apps/web/emails/brand-abuse-report.tsx` — formal letter to brand security, PII-redacted scam content, evidence summary, Ask Arthur ref ID.
- `apps/web/emails/acma-spam-forward.tsx` — minimal forward wrapper.

### B.5 Components

- **New** `apps/web/components/result/OnwardReportPicker.tsx` — destination checkboxes from `/api/report/destinations`, posts to `/api/report/onward`.
- **New** `apps/web/components/result/OnwardReportSummary.tsx` — post-submit "Here's what we did" panel with status badges (Sent/Queued/Skipped/Needs your help) + Scamwatch deep-link with clipboard-prefilled evidence block.
- **New** `apps/web/lib/onward/destinations.ts` — evidence-block builder, deep-link constructor, scam_reports → display payload.
- **New** `apps/web/lib/onward/redact.ts` — PII redaction for email body (names, emails, phones, BSB, account numbers).
- **Modify** `apps/web/components/result/ResultActionButtons.tsx` — "Report this scam" → opens picker (replacing the inline confirm-then-callback shape; the threat-feed contribution still happens via existing ScamReportCard).

### B.6 Trust guardrails (precision over volume)

- **Manual-review gate** on first 10 sends to any new brand. Admin Telegram alert + dashboard approval.
- **Per-brand send-rate ceiling** — Inngest `rateLimit: { limit: 5, period: '24h', key: 'event.data.destination_key' }` for brand-abuse.
- **Reply-to monitoring** — `brendan@askarthur.au` inbox, human-watched (single sender identity for now per founder direction 2026-05-08; revisit dedicated `reports@` subdomain once volume justifies). Bounce or "stop" auto-disables `is_active=false`.
- **Public accuracy page** (Workstream C) — verifiable false-positive/-negative rates from `verdict_feedback`.

## 5. Workstream C — Passive trust signals

**Reframed:** no qualified-moment review CTAs. Trust is earned via product quality, not solicited at filtered moments.

### C.1 Trustpilot free profile + footer TrustBox

- Claim `trustpilot.com/review/askarthur.au` (free).
- `apps/web/components/trust/Trustbox.tsx` — `Script` + `useEffect` + `loadFromElement` SPA pattern. Micro variant. Footer of `apps/web/app/layout.tsx`.

### C.2 G2 + Capterra free profiles (B2B)

- Claim free profiles (consulting). Capterra auto-syndicates to GetApp + Software Advice.
- `apps/web/app/reviews/page.tsx` — direct review-page links, B2B-tier-gated.
- **No paid plans.** Defer until ARR > A$1M.

### C.3 Public accuracy page

- `apps/web/app/accuracy/page.tsx` — rolling 30-day false-positive / false-negative rates from `verdict_feedback`, broken out by scam type.
- Surfaces UNSOLICITED 👎 signal — opposite of review-funnel selection bias.
- Verifiable, not solicited. _This is our Trustpilot replacement_ for a tool like this.

### C.4 What's deliberately NOT in scope

- ❌ Qualified-moment in-app review CTA (`ReviewPrompt.tsx`)
- ❌ `review_prompt_log` table
- ❌ Trustpilot Invitation API wiring
- ❌ Paid Trustpilot/G2 tiers

All of the above are review-funnel mechanics that bias the trust signal. Reasoning recorded in chat 2026-05-08.

## 6. Phasing — single PR, sized ~5–6 person-days realistic

**Phase 0 — Plan + branch** _(this commit)_

- Branch cut, plan doc filed.

**Phase 1 — Workstream A**

1. Install `@notionhq/client`.
2. `lib/notion/{client,feedback-tracker}.ts`.
3. ContactForm augment.
4. /api/leads dual-write.

**Phase 2 — Workstream B core** 5. Migration v119 (known_brands ext + seed + onward_report_log + RPC). 6. /api/report/destinations + /api/report/onward. 7. Inngest workers (brand-abuse with manual-review gate; ACMA; 3× skipped-with-deeplink stubs). 8. React Email templates. 9. OnwardReportPicker + OnwardReportSummary + lib/onward/\*. 10. ResultActionButtons rewire.

**Phase 3 — Workstream C passive trust** 11. Trustbox footer component + slot in layout. 12. /reviews B2B page. 13. /accuracy public page (verdict_feedback rolling stats RPC).

**Phase 4 — Smoke test + PR** 14. `pnpm turbo typecheck`. 15. Manual smoke of /contact form, picker dry-run. 16. PR body lists migration + post-merge verification checklist.

## 7. Out of scope (deferred to follow-up plans)

- `/settings/my-data` page (APP 12/13 compliance UI).
- Brand-contact staleness cron (quarterly fetch + regex).
- Nightly SMTP probe.
- Mobile / extension parity for ContactForm + onward picker.
- ACMA `.eml` attachment forwarding.
- Telegram inline-keyboard triage callbacks.
- PIA document → `docs/compliance/`.
- Privacy page section updates.

## 8. Risks & known gotchas

- **Notion `status` API limit** — must create custom status options in UI before deploy.
- **Resend deliverability** — reuses existing `brendan@askarthur.au` sender (already SPF/DKIM/DMARC-aligned via the leads/welcome path). Single identity = single domain alignment until volume justifies a dedicated `reports@` subdomain. Per founder direction 2026-05-08.
- **Migration ordering** — `onward_destination` and `onward_status` ENUMs created idempotently via DO blocks (ENUM types don't support `IF NOT EXISTS` directly).
- **PL/pgSQL OUT-param shadowing** — RPC uses `#variable_conflict use_column` per CLAUDE.md.
- **Lint-staged contamination** — small focused commits, explicit file paths in `git add`. Per memory note `feedback_lintstaged_contamination.md`.
- **Manual-review gate** — first 10 sends per brand_key go through admin approval. Without this, a bug in scam_type detection could spam ANZ within hours.

## 9. Post-merge verification

1. `mcp__supabase__apply_migration` v119 to `rquomhcgnodxzkhokwni`.
2. `mcp__supabase__get_advisors` (security + performance) — fix any new ERRORs.
3. Manual smoke:
   - Submit a Bug from /contact → confirm Notion page + Telegram alert + Resend email.
   - Trigger an analysis with impersonatedBrand → confirm picker shows brand-abuse row.
   - Submit picker selections → confirm `onward_report_log` rows + Inngest events.
   - Confirm /accuracy page renders with non-zero stats.
4. Telegram alert lands in correct chat (admin or feedback chat if `TELEGRAM_FEEDBACK_CHAT_ID` set).
