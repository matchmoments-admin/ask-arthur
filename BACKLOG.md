# Ask Arthur — Feature Backlog

Deferred features organized by platform. Items here are validated ideas that didn't make MVP but are worth building.

---

## Result Screen V2 — follow-up sprints

P0 (feedback widget, two-button footer, invalid-state, honest progress) is now
the default experience — the `NEXT_PUBLIC_FF_RESULT_SCREEN_V2` flag was retired
alongside the AskSilver-inspired simplification (v67 migration widens the
`verdict_feedback.user_says` CHECK to accept `user_reported`). Queued follow-ups:

- **Structured red-flag payload** — `redFlags` is currently a flat `string[]` and
  `ResultCard.splitFlag()` heuristically splits on the first sentence boundary
  to derive `{ heading, body }` for the left-bar cards. Update the Claude
  analyze prompt + `@askarthur/types` schema to return `Array<{ heading, body }>`
  directly, then retire `splitFlag()`.
- **P1 onward-reporting** — destination picker `OnwardReportingCard`,
  `onward_report_log` + `brand_abuse_contacts` tables + `get_onward_destinations`
  RPC, Inngest workers for brand-abuse email + ACMA spam forwarding + Scamwatch/
  ReportCyber/IDCARE deep-link handoffs, Resend templates (`brand-abuse-report.tsx`,
  `acma-spam-forward.tsx`), SPF/DKIM/DMARC for `reports@askarthur.au`,
  `NEXT_PUBLIC_FF_ONWARD_REPORTING` flag. Currently "Report this scam" POSTs
  `userSays: "user_reported"` to `/api/feedback` and opens the Scamwatch portal
  in a new tab — the picker replaces that with a structured handoff.
- **P2 governance + self-service** — `/settings/my-data` (view + delete feedback
  and submissions), quarterly brand-contacts staleness cron, nightly SMTP probe
  on abuse inboxes, PIA document + public summary, admin triage queue for
  false-positive feedback, unsubscribe/encryption helper for `followup_email`.
- **Extension + mobile parity** — thumbs widget + simplified card + destination
  picker on both `apps/extension/src/components/ResultDisplay.tsx` and
  `apps/mobile/components/AnalysisResult.tsx`. Neither surface has any feedback
  UI today; both still render the pre-simplification layout (confidence meter,
  next steps, brand prompt, recovery guide).
- **Honest progress via streaming** — current P0 approximates with client-side
  fetch-boundary transitions. If `/api/analyze` gains SSE or streaming JSON,
  swap `AnalysisProgress`'s `currentStep` prop to read actual server events.
- **Restore deferred signals** — confidence meter, deepfake gauge, scam-report
  card, brand verification prompt, recovery guide, and Scamwatch CTA were
  removed from the hero web card to match competitor simplicity. Components
  remain on disk (`DeepfakeGauge.tsx`, `RecoveryGuide.tsx`, `ScamReportCard.tsx`)
  for reuse in the B2B dashboard, audit reports, or the extension popup.

---

## Mobile

- [x] AI consent modal (Apple Guideline 5.1.2(i) compliance)
- [x] Recovery guidance component (Australian contacts)
- [ ] Push notifications (scam alerts for your area) — backend complete (v32 `device_push_tokens`), UI pending
- [ ] Call screening via Android CallScreeningService
- [ ] SMS filtering via iOS ILMessageFilterExtension
- [ ] Offline scam database (expo-sqlite) for common patterns
- [ ] Share extension (analyse content from other apps)
- [ ] Biometric auth for scan history
- [ ] Scam simulator (educational tool — spot the fake)
- [ ] Family protection (manage multiple numbers) — backend complete (v33 `family_groups`/`family_members`/`family_activity_log`), UI pending
- [ ] Dark/light theme toggle

## Telegram

- [ ] Image/screenshot analysis (send photo of scam)
- [ ] Phone number lookup (Twilio integration)
- [ ] Group mode (add bot to group, auto-scan links)
- [ ] Telegram Stars payments (premium features)
- [ ] Streaming analysis (show results as they come in)
- [ ] Multi-language support

## WhatsApp

- [x] AI disclosure welcome message (Meta compliance)
- [x] "About" button for AI transparency
- [ ] Image analysis (forward screenshot of scam)
- [ ] Document analysis (PDF/Word attachments)
- [ ] Phone number lookup
- [ ] Status/story link checking
- [ ] Business API catalog integration

## Slack

- [ ] Message shortcut (right-click any message to check)
- [ ] Workspace dashboard (admin stats)
- [ ] Automated email scanning (forward channel)
- [ ] Scheduled reports (weekly scam trends)
- [ ] Slack Connect support (cross-org)

## Messenger (Facebook)

- [ ] Full platform (deferred — Meta approval process is lengthy)
- [ ] Same feature set as WhatsApp bot
- [ ] Instagram DM integration

## Browser Extension

- [x] Email HTML/CSS injection hardening (hidden element stripping + server-side sanitization)
- [x] WXT `filterEntrypoints` inclusion-list gating — content scripts only ship in the manifest when their build flag is on. v1.0.0 minimal manifest has no `content_scripts` key at all (2026-04)
- [x] Per-install ECDSA P-256 signing (replaces shared-secret auth; Cloudflare Turnstile-gated registration; ±5 min skew; Redis nonce-replay protection) (2026-04)
- [x] Facebook ads content script + marketplace trust scoring + PayID chat detection — code shipped in v1.0.1 bundle, **flag-gated off** behind `WXT_FACEBOOK_ADS` + `NEXT_PUBLIC_FF_FACEBOOK_ADS`
- [ ] **URL Guard (`url-guard.content.ts`)** — code shipped, flag-gated off behind `WXT_URL_GUARD`. Activates phishing warning overlays on navigation. Server path is cheap (Google Safe Browsing + threat-DB, no Claude). Requires v1.0.2 manifest bump + `<all_urls>` host permission → sensitive-permission CWS re-review
- [ ] **Selector regression tests for `ad-detector.ts`** — Facebook restructures feed DOM ~monthly; capture 5–10 real feed HTML fixtures, write assertions against `detectSponsoredPost()` so we catch silent breakage within hours of any Facebook ship
- [ ] **Per-install hourly cap on `/api/extension/analyze-ad`** (60/hour) — defence-in-depth atop the existing 50/day bucket. Bounds worst-case MutationObserver misbehaviour (infinite feed on a hostile clone) and caps spend per extracted-secret attacker
- [ ] Email scanning via forwarding model (forward to analyse@askarthur.au)
- [ ] Page content analysis
- [ ] Phishing site warning overlay (distinct from URL Guard — proactive, not reactive)
- [ ] Safe browsing indicator in toolbar
- [ ] Website permission check — audit a site's requested browser permissions (camera, mic, location, notifications, clipboard) and flag overreach. Similar to the existing URL check but focused on permission hygiene rather than scam detection
- [ ] Website vulnerability check — scan a site for common security issues (mixed content, missing HSTS, open redirects, outdated TLS, exposed admin panels, missing CSP). Not scam detection — aimed at helping site owners and users understand if a site is safe to interact with. Results stored in `site_audits` table for trend analysis

## Website Safety Audits (Extension + Web)

Cross-platform features to help users and site owners assess website security — complementary to scam detection.

- [ ] **Permission check** — audit a website's requested browser permissions (camera, microphone, location, notifications, clipboard, payment). Flag overreach (e.g. a blog requesting camera access). Extension: real-time check on page load. Web: paste a URL to audit. Report card with permission-by-permission breakdown and risk assessment
- [x] **Vulnerability check (Phase 1)** — basic security header + TLS scanner with letter grade, deployed at `/audit`. Full version (open redirects, exposed admin panels, outdated server software) still TODO
- [ ] **Vulnerability check (Phase 2) — aka URL Security Report** — extended scanning. Scoped in Phase 14 Sprint 5 (see `ROADMAP.md` and `docs/vulnerability-tooling-expansion.md`). Only **7 net-new checks** vs. what `packages/site-audit` already ships: SEC-001 (Next.js `x-middleware-subrequest` / CVE-2025-29927), SEC-002 (React version fingerprint / CVE-2025-55182), SEC-003 (HTTP request smuggling probe), SEC-004 (cache-key confusion probes), SEC-006 (post-quantum TLS support / X25519MLKEM768), SEC-007 (certificate freshness — scam-infra signal), SEC-008 (SMTP smuggling MX probe / CVE-2023-51764-6). SRI, open-redirect, security-txt, security-headers, CSP, cookie-security, CORS, mixed-content, DNSSEC, SSL cert, TLS version, email-security, permissions-policy already exist as check modules.
- [x] **`site_audits` table** — created in v20 with schema: `site_id`, `overall_score`, `grade`, `test_results` (JSONB), `category_scores` (JSONB), `recommendations` (TEXT[]), `duration_ms`, `scanned_at`. Phase 14 Sprint 5 URL Security Report reuses this shape; Phase 14 adds `audit_type` only if the existing columns can't represent the new SEC-\* check class (TBD during implementation)
- [ ] **Site safety badge** — embeddable badge for site owners who pass audits (like SSL badges). Links back to askarthur.au with full report

## B2B / API

- [ ] **Phone Intel Card for B2B/Gov** — re-enable PhoneIntelCard UI (currently hidden from consumer web app) for paid government/enterprise tiers. Shows Twilio Lookup v2 data: carrier, line type, VoIP detection, CNAM caller name, 0-100 risk score. Phone intelligence still runs in the background and feeds into enrichment pipeline + risk scoring — this is just the consumer-facing card
- [x] Threat intel export views (4 views for government/law-enforcement data export, v38)
- [x] Provider reporting API (`submit_provider_report`, `get_unreported_entities`, v39)
- [x] Financial impact tracking (`record_financial_impact`, `get_jurisdiction_summary`, v40)
- [ ] Public entity API (batch scam checking)
- [ ] Threat intelligence feeds (real-time scam data)
- [ ] Brand monitoring (detect impersonation)
- [ ] Carrier feeds (Telstra/Optus integration)
- [ ] White-label widget (embed on any site)
- [ ] Webhook notifications for new threats
- [ ] SOC integration (SIEM connectors)

## Government Reporting

Infrastructure is in place (v38–v40). Future work:

- [ ] Automated ACCC Scamwatch submission (API integration when available)
- [ ] Bank API integration (CBA/NAB/WBC/ANZ fraud reporting endpoints)
- [ ] Telco number-blocking requests (Telstra/Optus APIs)
- [ ] ACSC cyber incident automated reporting
- [ ] AFP ReportCyber integration
- [ ] State police jurisdiction routing (using `get_jurisdiction_summary` data)

## Pipeline / Scrapers

- [ ] Fix broken scrapers (manual-only, low priority): ThreatFox (401 — API key expired), crt.sh (NoneType `.strip()` — null domain bug), PhishStats (95s timeout — upstream slow/down), CryptoScamDB (404 — GitHub source gone, likely dead)

## Cost Observability & Infrastructure

Related to Phase 13 in `ROADMAP.md`. Items that need action before (or as) we hit the relevant trigger.

- [ ] **Hive AI pricing contract** — negotiate per-image rate with Hive commercial. Blocks enabling Facebook Ads image scanning in production (the `logCost` call at `/api/extension/analyze-ad:155` is a `unitCostUsd: 0` placeholder until the contract lands)
- [ ] **`PRICING.HIVE_AI_USD_PER_IMAGE` constant update** — once the contract is signed, add to `apps/web/lib/cost-telemetry.ts` PRICING block + swap the inline `0` at `analyze-ad/route.ts:155` for the constant
- [ ] **Threat-DB → Supabase Edge Function + Cloudflare CDN** — trigger: when `/api/extension/extension-security/threat-db` starts returning non-stub data. Requires Supabase CLI init (new `supabase/functions/` directory), ETag support in `apps/extension/src/lib/threat-db.ts`, Cloudflare DNS subdomain for caching. ~3 hours when triggered
- [ ] **`cost_telemetry` retention job** — trigger: table exceeds ~20M rows (~6 GB; Supabase Pro quota is 8 GB). Simple `pg_cron` nightly delete past 180 days, or archive to R2 first if RDTI evidence retention is wanted
- [ ] **Automated budget caps / kill-switches** — trigger: 2+ weeks of steady-state Tier-2 telemetry gives us a baseline. Hourly cron reads `today_cost_total`, flips a Redis kill-switch at `DAILY_HARD_CAP_USD` that makes `/api/analyze` + `/api/extension/analyze` return 503 until manually reset
- [ ] **Bot queue live-activation checklist** — when the first bot (Telegram/WhatsApp/Slack/Messenger) goes live: generate `SUPABASE_WEBHOOK_SECRET` (`openssl rand -hex 32`), set it in Vercel + Supabase dashboard, create the Database Webhook on `public.bot_message_queue` INSERT → `https://askarthur.au/api/bot-webhook` with `X-Webhook-Secret` header

## Ops / Infrastructure

- [ ] **ABN footer hardcode + privacy policy** — replace "ABN pending registration" with `ABN 72 695 772 313` in footer component + `/privacy` contact section
- [ ] **`ABN_LOOKUP_GUID` in Vercel** — ABR Web Services credential. `/api/abn-lookup` route already exists and `StepABNVerify` calls it. Without the env var the onboarding ABN-verify step fails
- [ ] **Vercel domain redirect direction** — confirm bare `askarthur.au` is the primary (200) and `www.askarthur.au` is a 308 redirect to bare. Critical for extension: the v1.0.1 manifest's `host_permissions` specifies the bare domain, and Chrome MV3 does NOT follow cross-origin redirects for content-script-triggered fetches
- [ ] **Resend domain verification at domain level** — not per-mailbox. After the email consolidation to `brendan@askarthur.au`, any transactional email (welcome, org invite, weekly blog alerts) will bounce if DKIM/SPF is only verified for `alerts@` or `noreply@`. Test with a welcome email to yourself post-deploy
- [ ] **Chrome Web Store v1.0.1 submission** — upload `apps/extension/dist/askarthurextension-1.0.1-chrome.zip` once Hive contract + `HIVE_API_KEY` + `NEXT_PUBLIC_FF_FACEBOOK_ADS=true` are all in Vercel. Privacy-tab justification for Facebook host permissions documented in the related plan file. 1–3 day re-review expected (new sensitive permission)

## Database Hygiene & SPF Readiness

Deferred items from the 2026-04-23 database audit (`mcp__supabase__get_advisors`
against project `rquomhcgnodxzkhokwni`). P0 items shipped in migration v78
(`fix/db-p0-security-hygiene`) — items below are the deliberately-deferred work
that needs its own PR because the blast radius or scope is larger.

### Advisor cleanup — queued

- [ ] **Drop 177 unused indexes** — `vulnerabilities` alone carries 11; `scam_reports` 9; `subscriptions` 6; `scam_entities` / `flagged_ads` 5 each. Own PR so a rare-query regression is easy to revert. Run `pg_stat_user_indexes` again after 30 days of prod traffic before finalising the drop list
- [ ] **Resolve 21 empty partitioned shadow tables** — `cost_telemetry_partitioned*`, `scam_reports_partitioned*`, `feed_items_partitioned*` exist but have zero rows. Decision: either finish the `pg_partman` cutover (per `docs/partitioning-runbook.md`) or drop the shadows. Blocked on: confirming whether the v-series migration that created them intended a maintenance-window cutover that never ran
- [ ] **Rewrite 16 `USING (true)` RLS policies** on `check_stats`, `email_subscribers`, `feed_ingestion_log`, `scam_crypto_wallets`, `scam_ips`, `scam_urls`, `verified_scams`. These are the consumer-facing public surfaces — each needs a policy that lets the intended reader through and blocks everything else. Behavioural risk: rate-limited feed UI + public stats can break if done wrong
- [ ] **Consolidate multiple-permissive-policy duplication** on `api_keys` (20 findings), `org_members` (20), `org_invitations` (10), `user_profiles` (10). Pattern: collapse service-role + user-scope + org-scope policies to one permissive policy per role with `(select auth.uid())` wrapping — also resolves 55 `auth_rls_initplan` warnings in the same pass
- [ ] **Move `pg_trgm` extension out of `public`** — `CREATE SCHEMA IF NOT EXISTS extensions; ALTER EXTENSION pg_trgm SET SCHEMA extensions`. Closes the remaining ~32 `function_search_path_mutable` findings (they're all `gtrgm_*` / `similarity*` / `word_similarity*` functions owned by the extension). Must update any SQL that references `public.similarity()` etc. explicitly
- [ ] **Enable HIBP leaked-password protection** in Supabase Auth settings (dashboard toggle, no migration)
- [ ] **Add explicit deny-all policies to `cost_telemetry` + its 12 monthly partitions** — clears the 23 `rls_enabled_no_policy` INFO findings. Cosmetic but keeps the advisor board clean

### Phase 1 commercial readiness (April 2026 roadmap)

- [ ] **Case management tables** — `cases`, `case_entities`, `case_transitions`, `case_evidence`, `case_notes`, `case_tasks`, `case_merges` with `new → triaged → investigating → confirmed → reported → resolved / false_positive / duplicate / merged` state machine. Bank-sellable baseline; no commercial fraud platform ships without it
- [ ] **Append-only `audit_log` with hash chain** — `bigserial` id, `prev_hash` + `row_hash = sha256(prev_hash || payload)` per row; periodic `audit_anchor` external WORM publish. Required for SPF Respond, CPS 234 incident response, Australian Evidence Act 1995 admissibility. SOC 2 CC6/CC7 evidence
- [ ] **`evidence` pointer table + S3 Object Lock Compliance-mode bucket** + per-access `evidence_custody` events. Chain-of-custody for anything that may end up in AFCA/court
- [ ] **`spf_principle_events` table** — `principle enum(govern, prevent, detect, report, disrupt, respond)`, `event_kind`, polymorphic `source_table`/`source_id`, `occurred_at`. Drives the SPF scorecard widget (six traffic-light tiles) on `/app/compliance`. Projects existing events onto the six Treasury SPF §58BB principles
- [ ] **Partition `api_usage_log` daily** via `pg_partman` + hourly/daily materialised rollups + 30-day raw retention. Current per-row writer will detonate at enterprise ingestion
- [ ] **Webhook delivery ledger** — `webhook_endpoints`, `webhook_events`, `webhook_deliveries` with HMAC-SHA256 signing, exponential backoff ≤3 days, idempotency on `webhook_events.id`, dead-letter state with manual replay. Banks expect Stripe/Standard Webhooks-grade guarantees
- [ ] **Tenant residency groundwork** — extend `organizations` with `primary_region`, `allowed_regions[]`, `kms_key_ref`, `data_classification`. Table stakes for enterprise contracts and BYOK
- [ ] **Wire `logCost()` into every `/api/analyze` path** — `cost_telemetry` currently has 3 rows despite ongoing analyze traffic, so the writer is not invoked on most paths. Code change, not schema
- [ ] **Enable the four Phase-1 production feature flags** (`NEXT_PUBLIC_FF_DATA_PIPELINE`, `_ENTITY_ENRICHMENT`, `_RISK_SCORING`, `_CLUSTER_BUILDER`) and run the pipelines end-to-end so `scam_clusters`, `scam_entities.risk_score`, and `vulnerability_detections` populate with real data. Today's demos fall flat because the tables are empty
- [ ] **`reddit_processed_posts` retention** — not read by the web app; grows unbounded without a retention job. Pattern: nightly `cleanup_old_reddit_posts(60)` via `pg_cron`

### Non-schema advisor TODOs

- [ ] **Run vulnerability enrichment pipeline end-to-end** — 2,139 rows ingested into `vulnerabilities` but `vulnerability_detections` and `vulnerability_exposure_checks` still at 0. `/admin/vulnerabilities` shows CVE ingestion is working; the `match-b2b-exposure` Inngest function is either not firing or has no sites to match against
- [ ] **Reconcile feed cadence docs** — `ARCHITECTURE.md` claims 15-minute feed sync; production runs weekly via GitHub Actions cron. Either lift the cadence or correct the doc

## Web App

- [x] Phone intelligence in analysis pipeline (Twilio Lookup v2)
- [x] Phone Risk Report Card — CNAM caller name, 0-100 risk score, carrier/line-type/country grid, visual parity web + mobile
- [x] Scam recovery guidance UI (Australian contacts, collapsible)
- [x] SEO blog content seed script (7 targeted Australian scam posts)
- [x] Scam Report Card integrated into result view (contact/URL reporting)
- [x] Per-IP sliding-window rate limit on `/api/analyze` image uploads (5/h) (2026-04)
- [x] Admin cost dashboard at `/admin/costs` with today/last-7d/WoW delta/top-5 features (2026-04)
- [x] Consolidated all contact emails to `brendan@askarthur.au` (retired 8 distinct addresses across web, legal docs, pitch materials) (2026-04)
- [ ] Breach check page (use /api/breach-check from web UI)
- [ ] Bot setup wizard (guided Telegram/WhatsApp/Slack setup)
- [x] Public scam feed (`/scam-feed` + `/api/feed`, v44 `feed_items` table, Reddit + verified + user reports)
- [ ] **Deepfake detection wiring into `runMediaAnalysis`** — `lib/deepfakeDetection.ts` orchestrator + Reality Defender + Resemble SDKs are all built but `detectDeepfake()` is never invoked from the media pipeline. Needs `/tmp` buffer write (Reality Defender API requires file path) + presigned R2 GET URL (Resemble fallback). ~2 hours to wire
- [ ] **Phone intelligence consumer UI** — `/api/analyze` already returns the `phoneIntelligence` object (Twilio Lookup v2: carrier, VoIP, risk score, CNAM) but `ResultCard.tsx:74` receives it without rendering. ~30 lines to surface as a report-card block matching the existing red-flags section. Data flows to enrichment/scoring regardless; this is consumer visibility only
- [ ] **Chunked audio support for Whisper** — current hard 25 MB / ~1 hour API limit (`apps/web/lib/whisper.ts:25`). Longer uploads need segmentation + per-chunk transcription + concatenation. Currently throws at the 25 MB boundary
- [ ] Scam trend analytics dashboard
- [ ] Email forwarding analysis (forward scam emails to check@askarthur.au)
- [ ] Website permission check (web version) — let users paste a URL to audit its requested browser permissions. Report card showing which permissions the site requests and whether they're justified for the site's purpose
- [ ] Website vulnerability check (web version) — let users paste a URL to get a security health report. Check TLS version, HSTS, CSP, mixed content, open redirects, exposed endpoints. Store results in `site_audits` for longitudinal tracking
