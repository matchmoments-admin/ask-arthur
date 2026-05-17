# Ask Arthur — Canonical Data Flows

Six end-to-end flows that explain how the system talks to itself. Each flow lists the entry point, the work the request does inline, what gets handed off async, and which tables / RPCs / Inngest events are involved.

For any route mentioned, see [web-surface.md](./web-surface.md). For any table or RPC, see [database.md](./database.md). For any cron or Inngest function, see [background-workers.md](./background-workers.md).

---

## 1. Analyze pipeline — `/api/analyze`

The core flow: user submits text / URL / image / email; service returns verdict; storage + enrichment happen async.

```
POST /api/analyze
  │
  ├─ 0.  IP extraction (@vercel/functions.ipAddress) — 400 if unresolvable in prod
  ├─ 0a. Resolve request_id (Idempotency-Key header OR generated ULID; echoed as X-Request-Id)
  ├─ 1.  Payload size check (413 if >10MB)
  ├─ 2.  Rate limit (429 — two-tier: 3/hour burst + 10/day per IP+UA hash; fail-CLOSED in prod)
  ├─ 3.  Input validation (Zod, WebAnalyzeInputSchema from @askarthur/types)
  ├─ 3a. Image validation (base64 size pre-check + magic-byte sniff)
  ├─ 3b. Image-upload rate limit (5/h per IP, fail-CLOSED)
  ├─ 4.  Injection-pattern detection (14 regex patterns, NFKC-normalised)
  ├─ 5.  Redis cache lookup (composite versioned key, per-verdict TTL)
  │      └─ Cache hit → return cached verdict + X-Request-Id + increment_check_stats
  ├─ 6.  Geolocation (synchronous via x-vercel-ip-* headers)
  ├─ 7.  URL extraction
  │      ├─ Google Safe Browsing API check
  │      └─ Redirect-chain resolution (flag: redirectResolve)
  ├─ 8.  Parallel processing
  │      ├─ analyzeWithClaude  (Anthropic timeout: 30s vision / 15s text)
  │      └─ URL reputation checks
  ├─ 9.  mergeVerdict (@askarthur/core-analysis)
  │      ├─ Escalate → HIGH_RISK if any URL flagged
  │      ├─ Floor → SUSPICIOUS if injection detected
  │      └─ Tiered escalation on deepfake signals
  ├─ 10. Phone intelligence (HIGH_RISK/SUSPICIOUS only — inline this phase)
  │      └─ Twilio Lookup v2 (line type + CNAM, $0.018/lookup)
  ├─ 11. Background work
  │      ├─ If FF_ANALYZE_INNGEST_WEB=true (Phase 2):
  │      │   └─ emit `analyze.completed.v1` (id = requestId, dedup 24h)
  │      │       │
  │      │       ├─ → analyze-completed-report     (Inngest fan-out)
  │      │       │      → create_scam_report RPC + upsert_scam_entity + link_report_entity
  │      │       │
  │      │       ├─ → analyze-completed-brand
  │      │       │      → INSERT brand_impersonation_alerts (when impersonatedBrand + verdict ≠ SAFE)
  │      │       │
  │      │       └─ → analyze-completed-cost
  │      │              → INSERT cost_telemetry (feature='analyze', tokens, request_id)
  │      │
  │      ├─ Else (legacy waitUntil path):
  │      │   └─ storeScamReport + createBrandAlert + logCost inline (best-effort)
  │      ├─ storeVerifiedScam (waitUntil — pending Phase 2b R2 image-staging design)
  │      ├─ Cache text-only results in Redis (PII-scrubbed before write)
  │      └─ increment_check_stats RPC (atomic daily counters)
  └─ 12. Response with X-Request-Id + X-RateLimit-Remaining
```

### Three layers of idempotency

Each layer is the safety net for the layer above:

1. **HTTP** — `Idempotency-Key` header (Stripe-style ULID or 8–255 char alphanumeric/dash/underscore). Echoed back as `X-Request-Id`. Absent → server generates a ULID.
2. **Inngest** — event published with `id: requestId` (24h dedup); each consumer sets `idempotency: "event.data.requestId"` (function-level dedup).
3. **Postgres** — `scam_reports.idempotency_key` partial unique index + `create_scam_report` RPC `ON CONFLICT ... DO UPDATE` returns original row id. Authoritative backstop (v73).

### Request schema

```typescript
{
  text?: string        // Max 10,000 characters
  image?: string       // Legacy single image (base64)
  images?: string[]    // Multi-image (max 10, each max 5MB)
  mode?: "text" | "image" | "qrcode"
}
```

### Response schema

```typescript
{
  verdict: "SAFE" | "SUSPICIOUS" | "HIGH_RISK"
  confidence: number      // 0.0–1.0
  summary: string         // Max 500 chars
  redFlags: string[]      // Max 10
  nextSteps: string[]     // Max 10
  scamType: string        // e.g. "phishing", "impersonation"
  impersonatedBrand: string | null
  channel: "email" | "sms" | "social_media" | "phone" | "website" | "other"
  scammerContacts: {
    phoneNumbers: { value: string, context: string }[]
    emailAddresses: { value: string, context: string }[]
  }
  phoneIntelligence?: {     // Present when phone detected in HIGH_RISK/SUSPICIOUS
    valid: boolean
    phoneNumber: string     // E.164
    countryCode: string | null
    nationalFormat: string | null
    lineType: string | null // "mobile" | "landline" | "nonFixedVoip" | …
    carrier: string | null
    isVoip: boolean
    riskFlags: string[]
    riskScore: number       // 0–100
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    callerName: string | null
    callerNameType: "business" | "consumer" | null
  }
}
```

### Phase 2b backlog

`storeVerifiedScam` still runs on the route's `waitUntil` pending an R2 image-staging design. Consequence while `FF_ANALYZE_INNGEST_WEB=true`: `scam_reports` rows for HIGH_RISK cases do not carry `verified_scam_id`. Phase 2b restores the link.

---

## 2. Reddit Intel pipeline

Daily extraction of scam narratives from `r/Scams` → classification → embedding → clustering → digest. Source: `pipeline/scrapers/reddit_scams.py` writes to `feed_items`; pipeline picks up from there.

```
GH Action: reddit_scams.py
  └─ Daily 06:00 UTC, gated ENABLE_SCRAPER
     └─ INSERT feed_items (source='reddit', external_post_id UNIQUE)
                       │
                       │ next poll
                       ▼
Vercel cron: /api/cron/reddit-intel-trigger  (0 8 * * *)
  └─ if redditIntelIngest flag ON
     └─ poll get_unembedded_narrative_feed_items(40) for source='reddit'
     └─ emit Inngest event: reddit.intel.batch_ready.v1
                       │
                       ▼
Inngest: reddit-intel-daily
  └─ Sonnet 4.6 classifier per batch (cost-brake gated, REDDIT_INTEL_CAP_USD=$10/day)
  └─ INSERT reddit_post_intel (intent_label, modus_operandi, brands_impersonated[],
                               novelty_signals[], tactic_tags[], theme_id=NULL)
  └─ INSERT reddit_intel_quotes (PII-scrubbed ≤140 char)
  └─ emit Inngest event: reddit.intel.summarised.v1
                       │
                       ▼
Inngest: reddit-intel-embed
  └─ Voyage 3 embedding per post (1024d)
  └─ UPDATE reddit_post_intel.embedding (IVFFlat lists=100)
  └─ emit Inngest event: reddit.intel.embedded.v1
                       │
                       ▼
Inngest: reddit-intel-cluster  (also nightly fallback)
  └─ For each unclustered post:
     ├─ match_themes_by_centroid(post.embedding, limit=5)
     ├─ if cosine ≥ 0.78 with existing theme → assign theme_id
     └─ else → create new reddit_intel_themes row (slug, member_count=1, centroid=embedding)
  └─ INSERT reddit_post_intel_themes (M-to-many, is_primary, similarity)
  └─ UPDATE reddit_intel_themes (member_count, last_seen, signal_strength, wow_delta_pct)
                       │
                       ▼ daily summary
INSERT reddit_intel_daily_summary
  (cohort_date, audience, country_code, lead_narrative, emerging_threats JSONB, brand_watchlist JSONB)
                       │
                       │ weekly fan-out
                       ▼
Vercel cron: /api/cron/weekly-email  (0 14 * * 1)
  └─ Render WeeklyIntelDigest.tsx (regulatorAlerts + reddit themes)
  └─ Resend → opted-in users
                       │
                       │ retention
                       ▼
Vercel cron: /api/cron/reddit-intel-retention  (30 4 * * *)
  └─ cleanup_old_reddit_posts(30)
  └─ DELETE reddit_intel_quotes WHERE created_at < NOW() - 365d
```

**Cost cap:** A$10/day enforced via `feature_brakes.reddit_intel`. Errors land in `cost_telemetry WHERE feature='reddit-intel-error'`.

**B2B surface:** `/api/v1/intel/{themes, themes/[id], search, digest, quotes}` (gated `redditIntelB2bApi`). Public consumer pages `/intel/themes/[slug]` (gated `redditIntelPublicPages`). UTM tagging on outbound email + CTA links via `apps/web/lib/utm.ts`.

---

## 3. Phone Footprint refresh

A consumer / B2B feature: user (or fleet) saves a number for monitoring. Hourly claimer picks due monitors and runs a refresh pipeline against Vonage + Twilio + LeakCheck + breach index.

```
User adds a monitor
  └─ POST /api/phone-footprint/monitors
     ├─ assert_fleet_capacity(org_id)  (RPC)
     ├─ INSERT phone_footprint_monitors (consent_expires_at, refresh_cadence)
     └─ INSERT phone_footprint_refresh_queue (monitor_id UNIQUE)
                       │
                       │ next scheduled tick
                       ▼
Inngest: phone-footprint-refresh-claimer  (hourly, TZ=Australia/Sydney)
  └─ SELECT FROM phone_footprint_refresh_queue WHERE next_refresh_at <= NOW()
     ORDER BY priority LIMIT batch_size
  └─ For each monitor:
     └─ emit Inngest event: phone-footprint/refresh.monitor.v1
                       │
                       ▼
Inngest: phone-footprint-refresh-monitor
  └─ Cost-brake check (PHONE_FOOTPRINT_CAP_USD=$5/day; sum of telco_api_usage + cost_telemetry)
  └─ Parallel pillar fetch (with vendor-specific timeouts):
     ├─ Vonage NI v2 (fraud_score, line_type, carrier) ── flag: vonageEnabled
     ├─ Vonage CAMARA SIM/Device Swap
     ├─ Twilio Lookup v2 (CNAM, line_type)
     ├─ LeakCheck (breach exposure) ── flag: leakcheckEnabled
     ├─ check_breach_exposure(SHA256(msisdn), 'phone') RPC
     └─ phone_lookups cache
  └─ phone_footprint_internal(msisdn, …) RPC composes composite_score + pillar_scores
  └─ INSERT phone_footprints (one snapshot row per refresh; BRIN(expires_at))
  └─ DIFF against prior snapshot:
     ├─ band_change                 → INSERT phone_footprint_alerts
     ├─ score_delta > threshold     → INSERT phone_footprint_alerts
     ├─ new_breach in breach_check  → INSERT phone_footprint_alerts
     └─ sim_swap_event              → INSERT sim_swap_events + phone_footprint_alerts
  └─ UPDATE phone_footprint_monitors SET next_refresh_at, last_refreshed_at
                       │
                       │ if user requests a PDF
                       ▼
POST /api/phone-footprint/[msisdn]/pdf
  └─ emit Inngest event: pdf-export.requested.v1
                       │
                       ▼
Inngest: phone-footprint-pdf-render
  └─ Render React PDF
  └─ Upload to R2
  └─ Return signed URL via webhook / push
                       │
                       │ retention
                       ▼
Inngest: phone-footprint-retention  (03:15 UTC)
  └─ anonymise_expired_footprints(...)  (replace msisdn_e164 → 'REDACTED', keep hash for forensics)
  └─ sweep_inactive_monitors(...)        (soft-delete consent-lapsed)
```

**OTP verification** (`/api/phone-footprint/verify/{start,check}`) is a separate sub-flow when `twilioVerifyEnabled` is on. Anti-abuse forensics in `phone_footprint_otp_attempts`.

**Stripe sync:** when a subscription changes, `sync_phone_footprint_entitlements(...)` RPC updates `phone_footprint_entitlements.{saved_numbers_limit, monthly_lookup_limit, refresh_cadence_min}`.

---

## 4. Charity Check lookup

Free consumer page (`/charity-check`) backed by the ACNC register mirror + Voyage-embedded semantic search for fuzzy / typosquat matches.

```
User search on /charity-check
  └─ GET /api/charity-check/autocomplete?q=<prefix>
     └─ search_charities(q, 10) RPC (trigram + ILIKE prefix ranking)
     └─ → list of suggestions

User selects or submits free text
  └─ POST /api/charity-check
     ├─ check officialBrands whitelist for high-confidence match
     ├─ search_charities(query) — exact / trigram match against acnc_charities
     └─ If low confidence:
        ├─ Embed query via Voyage
        └─ match_charities_by_embedding(embedding, 5) RPC
           ─ JOIN against acnc_charity_embeddings (sibling table; HNSW)
           ─ Returns acnc_charities rows + similarity scores
     └─ charityResultToResultCard transforms result → card UI
     └─ Response with: legitimacy verdict, ABN, registered name, similar matches,
        external links (ACNC profile), PFRA membership status (lookup_pfra_member)
                       │
                       │ writes
                       ▼
INSERT cost_telemetry (feature='charity-check', ...)
INSERT scan_results (target=<charity>, scan_type='charity-check', visibility=…)
```

**Backfill pipeline:**

```
GH Action: pipeline/scrapers/acnc_register.py  (daily 16:00 UTC, gated ENABLE_CHARITY_CHECK_INGEST)
  └─ Fetch ACNC CKAN dataset (63,637 rows)
  └─ Chunked UPDATE/INSERT acnc_charities (≤5K rows/iteration, statement_timeout='300s')
  └─ TOUCH_LAST_SEEN_SQL via row_hash to skip unchanged rows  (reference pattern post-PR #187)

Inngest: acnc-charity-backfill-embed  (nightly 04:00 UTC)
  └─ SELECT acnc_charities WHERE NOT EXISTS (acnc_charity_embeddings.abn = …)
  └─ Voyage embed name + mission (chunked, cost-brake gated CHARITY_CHECK_CAP_USD)
  └─ INSERT acnc_charity_embeddings (sibling table; HNSW lives here, not on parent)
```

**Critical:** v121–v122 moved embeddings to a sibling table. Direct HNSW on `acnc_charities` would have made every daily scraper UPDATE rebuild index pages — the same failure mode as the 2026-05-09 incident. See [database.md](./database.md) §"Hot tables".

---

## 5. Bot dispatch — `bot_message_queue`

Multi-platform bot routing without polling. Webhook receives a user message; row goes into `bot_message_queue`; pg_net hits `/api/bot-webhook` directly from Postgres.

```
User messages Telegram / WhatsApp / Slack / Messenger
  └─ POST /api/webhooks/<platform>
     ├─ Verify HMAC signature (platform-specific)
     ├─ Rate limit (5 checks/h per user, sliding window, Upstash)
     ├─ Normalise to bot_message envelope
     └─ INSERT bot_message_queue (platform, user_id, content, status='pending')
                       │
                       │ pg_net trigger fires on INSERT
                       ▼
Supabase Database Webhook (pg_net.http_post)
  └─ HMAC-signed (SUPABASE_WEBHOOK_SECRET)
  └─ → POST /api/bot-webhook
                       │
                       ▼
/api/bot-webhook
  ├─ Verify HMAC
  ├─ SELECT FROM bot_message_queue WHERE status='pending' for this dispatch
  ├─ analyzeForBot(content, source=<platform>) ── @askarthur/bot-core
  │   └─ Internally calls @askarthur/scam-engine (Claude + URL checks in parallel)
  ├─ Per-platform formatter:
  │   ├─ toTelegramMessage   (HTML)
  │   ├─ toWhatsAppMessage   (markdown via Vonage)
  │   ├─ toSlackBlocks       (Block Kit)
  │   └─ toMessengerMessage  (plain text)
  ├─ Send via platform SDK
  └─ UPDATE bot_message_queue SET status='delivered' (or 'failed' + error_msg)
                       │
                       │ safety net for missed webhooks
                       ▼
Vercel cron: /api/cron/bot-queue-sweep  (every 6h)
  └─ SELECT bot_message_queue WHERE status='pending' AND created_at < NOW() - INTERVAL '2 minutes'
  └─ Re-dispatch via /api/bot-webhook

Vercel cron: /api/cron/bot-queue-cleanup  (daily 04:00 UTC)
  └─ DELETE bot_message_queue WHERE status IN ('delivered','failed') AND created_at < NOW() - '24 hours'
```

**Why pg_net not polling:** pg_net is unmetered on Supabase Pro and gives event-driven dispatch with no cron overhead. The 6h sweeper is the cheap belt-and-braces for the case where the webhook fails to fire (e.g. Supabase dashboard misconfiguration).

---

## 5b. Inbound-email user scan — `scan@askarthur.au`

Email-forward analogue of the bot dispatch flow. Users forward suspicious emails to `scan@askarthur.au` (or directly to `scan+report@askarthur-inbound.com`); Arthur replies with a verdict via Resend.

```
User forwards suspicious email
  └─ scan@askarthur.au (forwarding alias)
       │ (free GoDaddy/Cloudflare alias — no MX change on askarthur.au)
       ▼
  → scan+report@askarthur-inbound.com
       │
       ▼
Cloudflare Email Routing (askarthur-inbound.com zone)
  └─ Tag-based rule routes to the Email Worker
       │
       ▼
Cloudflare Worker (apps/cloudflare-email-worker)
  ├─ postal-mime parses MIME
  ├─ resolveSource() → "inbound_scan_report"  (new in F1)
  ├─ Dispatch branches on source:
  │     ├─ scan_report   → SCAN_REPORT_ENDPOINT_URL  (apps/web /api/inbound-scan)
  │     └─ everything else → SUPABASE_EDGE_FUNCTION_URL (intel-inbound-email)
  └─ POSTs structured JSON + X-Webhook-Secret
       │
       ▼
/api/inbound-scan  (apps/web/app/api/inbound-scan/route.ts)
  ├─ ENABLE_USER_SCAN_INBOUND kill switch (default on; "false" → 204)
  ├─ Verify x-webhook-secret (timing-safe)
  ├─ Zod-validate payload (source = "inbound_scan_report")
  ├─ Parse From: header → reply address + display name
  ├─ Rate limit: checkInboundScanRateLimit(sender) — 20/h per normalised sender
  ├─ analyzeForBot(subject + body_md, region="AU")
  │   └─ Same scam-engine path as the four chat bots (surface="bot")
  ├─ Resend email reply with verdict + redFlags + nextSteps
  └─ logCost(feature="inbound_scan", provider="channel") — volume rollup
```

**Cost model:** A$0.001 Claude Haiku per scan (counted via analyzeForBot's own telemetry) + outbound Resend (in plan). The `inbound_scan` cost-telemetry rows have `estimatedCostUsd=0` so the dashboard can split per-channel volume without double-counting Claude.

**Kill switches:** `ENABLE_USER_SCAN_INBOUND` (env on apps/web) toggles the endpoint. The Worker treats 204 as "drop quietly" so misroutes don't retry-storm.

**Why not the existing `intel-inbound-email` Edge Function:** that function writes to `feed_items` (newsletter ingestion). Scan-report emails need a different downstream — analyze + reply. Routing in the Worker (not in the Edge Function) keeps the two flows independent so a regression in either doesn't bleed across.

---

## 6. Onward reporting to regulators

After a HIGH_RISK verdict (and after manual admin approval), a report can be escalated to AU regulators (Scamwatch / ACMA / iDcare / ReportCyber).

```
User on verdict page clicks "Report to authorities"
  └─ POST /api/report/onward
     ├─ Pull report from scam_reports
     ├─ get_onward_destinations(verdict, scam_type, channel) RPC
     │  → returns list of applicable destinations:
     │     ├─ scamwatch        (HTML deep-link, no API)
     │     ├─ acma-email-spam  (ACMA report email/HTTP callback)
     │     ├─ report-cyber     (ASIC/ACCC ReportCyber HTTP callback)
     │     ├─ idcare           (IDcare referral)
     │     └─ ask-arthur-feed  (internal feed marker)
     └─ INSERT onward_report_log (scam_report_id, status='pending') per destination
                       │
                       │ admin gate
                       ▼
Admin reviews at /admin/onward-reports
  └─ POST /api/admin/onward-reports/approve
     ├─ Updates onward_report_log.status = 'approved'
     └─ emit Inngest event: report.submitted.v1 per destination
                       │
                       ▼
Inngest fan-out (event-driven, no cron):
  ├─ report-onward-scamwatch          → mark as 'delivered' (deep-link only)
  ├─ report-onward-acma-email-spam    → POST to ACMA callback endpoint
  ├─ report-onward-report-cyber       → POST to ReportCyber callback
  ├─ report-onward-idcare             → POST to IDcare referral endpoint
  ├─ onward-brand-abuse               → Brand-protection partner submission
  └─ report-onward-ask-arthur-feed    → INSERT into internal regulator_alert_pushes
       │
       │ on success/failure
       ▼
UPDATE onward_report_log.status = 'delivered' | 'failed'
INSERT cost_telemetry (feature='onward-report', destination=<name>)
                       │
                       │ delivery confirmation
                       ▼
INSERT regulator_alert_pushes (report_id, destination, delivered_at)
```

**Why event-driven, not cron:** these submissions are bursty and admin-approved. Cron polling would either lag or burn cost. Event-driven Inngest gives durable retry per destination with native idempotency on `report_id × destination`.

---

## Cross-flow patterns

A few invariants that hold across all six flows:

- **`SECURITY DEFINER` RPC is the only write path** for hot tables. No route or Inngest function calls `INSERT INTO scam_reports` directly; everything goes through `create_scam_report(...)` so the idempotency key and entity-link logic stay co-located.
- **Cost telemetry is logged at the call site, not centrally.** `logCost()` helper from `apps/web/lib/cost-telemetry.ts` writes one row per external API call. Per-feature aggregates are computed nightly by `cost-telemetry-retention` → `cost_telemetry_daily_rollup`.
- **Cost brakes are checked at the start of every paid operation**, not at the end. The brake reads `feature_brakes` for the feature and early-returns if a row exists with `paused_until > NOW()`. This means a misbehaving feature pauses itself for 24h once the brake fires; no further cost accrues until the operator clears the row or `paused_until` expires.
- **Idempotency is layered.** HTTP header → Inngest event ID → Postgres unique key. Each layer is the safety net for the layer above. A retried client request that bypasses HTTP cache still hits the Postgres backstop and returns the original row.
- **Hot-table writes always chunk.** Any scraper / retention job / backfill writing to a hot table chunks at ≤5K rows per iteration with a finite `statement_timeout` (`'300s'`). This is non-negotiable after incident 2026-05-09; the `db-migration-reviewer` agent (PR 2 of the SDD plan) enforces it on review.
