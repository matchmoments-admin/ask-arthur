# Protected Customer Data Level 2 — Shopify Partner Dashboard application (#366)

**Status:** ready to fill out. Action: brendan opens the [Shopify Partner Dashboard](https://partners.shopify.com), navigates to the Shopfront app's "Data access" page, submits the Level 2 application using the pre-drafted answers below.

**Lead time:** 3–6 weeks Shopify review. Longest-pole blocker for any merchant-data feature in Shopfront. Doesn't gate Stage 1 (badge + clone-detection + Verified Directory ship without it); does gate Stage 3 (chargeback features).

**Why submit now even though Stage 1 doesn't need it:** approval lands before Stage 2 expansion + Shopify Trust & Safety partnership conversations (#367) carry more weight when we already have PCD Level 2 in hand.

---

## Pre-drafted application answers

### Field 1 — Application narrative

> Ask Arthur Shield ("Shopfront") is a scam-detection and brand-protection app for Australian Shopify merchants. We need Protected Customer Data Level 2 to enable two specific surfaces:
>
> 1. **Chargeback-defence evidence packs** — when a merchant receives a chargeback, we generate a CE 3.0–compliant evidence document that combines order metadata (line items, billing/shipping addresses, IP, device fingerprint) with our scam-corpus signal (have we seen this email/phone/IP in confirmed scam reports?). This requires `customer.email`, `customer.phone`, and billing/shipping `customer.address` access.
> 2. **Buyer-trust verdict synthesis** — at order time, we cross-reference the buyer's email/phone/IP against our scam corpus (currently ~28K+ user-reported scams, 840 narrative-classified Reddit posts, 18 brand-impersonation alerts, 63,637 ACNC charity records) and return a SAFE/UNCERTAIN/SUSPICIOUS/HIGH_RISK verdict to the merchant's fraud-triage dashboard. This is value-add a Shopify merchant cannot get from any single existing app.
>
> All customer data is processed in Australia (Supabase ap-southeast-2 region), encrypted at rest with pgsodium, never shared with third parties, and retained only for the lifetime of the customer's order-related dispute window (typically 120 days from order date — Stripe / Shopify Payments default). We never sell, market against, or otherwise commercialise customer PII; the data exists solely to support the merchant's fraud-prevention surface and the chargeback-defence evidence generation. Encryption keys live in Supabase Vault; access is service-role-only and logged via `audit_log`. We comply with the Australian Privacy Act 1988 + APPs.

### Field 2 — Required data fields

Enumerate explicitly:

- `customer.email` — buyer-trust verdict + CE 3.0 evidence
- `customer.phone` — buyer-trust verdict + CE 3.0 evidence
- `customer.default_address` (full billing + shipping) — CE 3.0 evidence + cross-reference against scam-corpus addresses
- `order.line_items[].title` + `order.line_items[].sku` — clone-detection (matching against suspected clone-shop product titles)
- `order.client_details.browser_ip` — buyer-trust verdict
- `order.client_details.user_agent` — anomaly detection (device fingerprint stability)

NOT requested (out of scope):

- Payment card numbers (we never see PAN — Shopify Payments / Stripe abstract this)
- Customer notes, tags (merchant-internal data not needed for our surface)

### Field 3 — Privacy policy URL

`https://askarthur.au/privacy`

**Privacy policy update required BEFORE submission** — see "Privacy policy update text" below.

### Field 4 — Data retention period

120 days from order date (Stripe / Shopify Payments default chargeback window).

After 120 days: customer PII is purged from `shopfront_order_verdicts` + `shopfront_chargeback_evidence` via a daily Inngest retention sweep (chunked, ≤5K rows, `statement_timeout='300s'`). Aggregate scam-signal counters (NOT identifiable) are retained for corpus enrichment. Per CLAUDE.md retention pattern.

### Field 5 — Data security measures

- Tokens encrypted at rest with pgsodium (key in Supabase Vault, never logged, never in Inngest event payloads — incident-aware per Disputifier January 2026 breach)
- All PII fields encrypted at rest via pgsodium (separate key from tokens)
- Service-role-only RLS on `shopfront_order_verdicts` + `shopfront_chargeback_evidence` tables
- Outbound HTTP to attacker-controlled content (clone-detection scans) is SSRF-safe via custom undici dispatcher (commit `940784c`, issue #353 — closes DNS-rebinding TOCTOU)
- Cost telemetry + feature-brake monitoring via `cost_telemetry` table — all paid-API calls logged
- Annual third-party security audit (planned — when SPF-sector Layer 4 customers require SOC2-equivalent)
- Notifiable Data Breach (NDB) handling: incident response runbook in `docs/ops/incident-response.md` (TODO — create when first PCD-handling feature ships)

---

## Privacy policy update text (apply to `askarthur.au/privacy` BEFORE submitting)

Add a new section to the existing privacy policy:

> ### Merchant + buyer data processing (Ask Arthur Shield Shopify app)
>
> When Australian merchants install the Ask Arthur Shield Shopify app, we process buyer personal information on the merchant's behalf to provide fraud-prevention and chargeback-defence services.
>
> **What we process**: buyer email, phone, billing address, shipping address, and order metadata (line items, IP address, user-agent).
>
> **Why**: to compute a SAFE/UNCERTAIN/SUSPICIOUS/HIGH_RISK trust verdict for each order, and to generate Card Issuer Evidence 3.0–compliant evidence packs when the merchant receives a chargeback.
>
> **Where**: stored in Australia (Supabase Sydney region), encrypted at rest with pgsodium, accessed by service-role only.
>
> **How long**: 120 days from order date (matching the standard chargeback window). After 120 days, all personally-identifying buyer data is purged automatically.
>
> **Who we share with**: nobody. The data is processed solely for the installing merchant's fraud-prevention surface. We do not sell, market against, or otherwise commercialise customer PII. Aggregate signal counters (not identifiable) may be retained for corpus enrichment.
>
> **Your rights**: under the Australian Privacy Act 1988 + Australian Privacy Principles, you may request access to or deletion of personal information we hold about you. Contact privacy@askarthur.au.
>
> **Our data processor relationship with Shopify merchants**: when the Shopify app processes buyer PII, the merchant is the data controller and Ask Arthur is the data processor. Our data processing agreement (DPA) with merchants is available at `askarthur.au/trust/dpa`.

---

## Submission checklist

- [ ] Privacy policy at `askarthur.au/privacy` updated with the section above
- [ ] DPA published at `askarthur.au/trust/dpa` (already exists per `docs/system-map/`)
- [ ] Partner Dashboard → Shopfront app → Data access → "Apply for Protected Customer Data Level 2"
- [ ] Paste application narrative (Field 1)
- [ ] Paste required-fields list (Field 2)
- [ ] Confirm privacy policy URL (Field 3)
- [ ] Confirm retention period — 120 days (Field 4)
- [ ] Paste security measures (Field 5)
- [ ] Submit
- [ ] Log the application ID + submission date in the issue
- [ ] Calendar reminder: follow up if no response after 4 weeks (Shopify's stated lead time max)

---

## Dependencies this unblocks (eventually)

- **Stage 3 chargeback defence features** (CE 3.0 evidence, Verifi RDR, Ethoca alerts) — all blocked on this approval
- **Stage 2 supplier-vetting + outbound scam-link scanner** — likely fine without PCD-2 (don't need customer PII; verify with Shopify when scoping #378/#379)
- **Stage 1 clone-detection + Verified badge + Verified Directory** — all UNBLOCKED by this, ship without PCD-2

If Shopify REJECTS the Level 2 application: Stage 3 chargeback features degrade to hash-only clustering (IP + device + order metadata, no customer PII) per Shopfront plan §6 risk 1. ~25% signal loss but the badge + clone-detection layers stay intact.
