// Feature flags — env-var-based, toggleable via Vercel dashboard.
// NEXT_PUBLIC_ prefix makes these available on both server and client.
// Default: all OFF. Enable incrementally as each capability is verified.
//
// Server-side flags use `readBoolEnv` (from ./env) to defeat trailing-
// whitespace + build-time-inlining failure modes. NEXT_PUBLIC_* keeps
// the literal `process.env.NEXT_PUBLIC_X === "true"` pattern because the
// client bundle has no `process.env` and relies on build-time inlining.
// See packages/utils/src/env.ts for the full rationale.
import { readBoolEnv } from "./env";

export const featureFlags = {
  /** Phase 1: Audio upload → Whisper transcription → scam analysis */
  mediaAnalysis: process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS === "true",

  /** Phase 2: Deepfake detection on audio/video uploads */
  deepfakeDetection: process.env.NEXT_PUBLIC_FF_DEEPFAKE === "true",

  /** Phase 2: Phone number intelligence via Twilio Lookup v2 */
  phoneIntelligence: process.env.NEXT_PUBLIC_FF_PHONE_INTEL === "true",

  /** Phase 2: Video upload support (extends audio-only media input) */
  videoUpload: process.env.NEXT_PUBLIC_FF_VIDEO_UPLOAD === "true",

  /** Phase 3: Community scam contact reporting + lookup */
  scamContactReporting: process.env.NEXT_PUBLIC_FF_SCAM_REPORTING === "true",

  /** Phase 3: Scam URL reporting + WHOIS/SSL enrichment */
  scamUrlReporting: process.env.NEXT_PUBLIC_FF_SCAM_URL_REPORTING === "true",

  /** Phase 4: Threat feed ingestion pipeline + Inngest orchestration */
  dataPipeline: process.env.NEXT_PUBLIC_FF_DATA_PIPELINE === "true",

  /** Newsletter signup form on blog pages */
  newsletter: process.env.NEXT_PUBLIC_FF_NEWSLETTER === "true",

  /** Resolve URL redirect chains before reputation checking */
  redirectResolve: process.env.NEXT_PUBLIC_FF_REDIRECT_RESOLVE === "true",

  /** Chrome extension: Gmail email scanning */
  emailScanning: process.env.NEXT_PUBLIC_FF_EMAIL_SCANNING === "true",

  /** Website Safety Audit: lightweight security header scanner */
  siteAudit: process.env.NEXT_PUBLIC_FF_SITE_AUDIT === "true",

  /** Email security checks (SPF/DMARC/DKIM) in site audit — zero cost, default ON */
  emailSecurityChecks: process.env.NEXT_PUBLIC_FF_EMAIL_SECURITY_CHECKS !== "false",

  /** Recovery guidance steps on HIGH_RISK / SUSPICIOUS verdicts */
  recoveryGuidance: process.env.NEXT_PUBLIC_FF_RECOVERY_GUIDANCE === "true",

  /** Intelligence Core: store unified reports + entity linkage */
  intelligenceCore: process.env.NEXT_PUBLIC_FF_INTELLIGENCE_CORE === "true",

  /** Entity enrichment: auto-enrich high-report-count entities with external intel */
  entityEnrichment: process.env.NEXT_PUBLIC_FF_ENTITY_ENRICHMENT === "true",

  /** Cluster builder: auto-group related scam reports by shared entities */
  clusterBuilder: process.env.NEXT_PUBLIC_FF_CLUSTER_BUILDER === "true",

  /** Risk scoring: composite 0-100 risk scores per entity */
  riskScoring: process.env.NEXT_PUBLIC_FF_RISK_SCORING === "true",

  /** AbuseIPDB IP reputation lookups during enrichment */
  abuseIPDB: process.env.NEXT_PUBLIC_FF_ABUSEIPDB === "true",

  /** URLScan.io async URL scanning during enrichment */
  urlScanIO: process.env.NEXT_PUBLIC_FF_URLSCAN === "true",

  /** HIBP email breach checking during enrichment */
  hibpCheck: process.env.NEXT_PUBLIC_FF_HIBP === "true",

  /** Certificate Transparency log lookups during enrichment */
  ctLookup: process.env.NEXT_PUBLIC_FF_CT_LOOKUP === "true",

  /** IPQualityScore phone number fraud scoring during enrichment */
  ipqualityScore: process.env.NEXT_PUBLIC_FF_IPQS === "true",

  /** Stripe billing — pricing page and checkout */
  billing: process.env.NEXT_PUBLIC_FF_BILLING === "true",

  /** User auth, dashboard, and API key self-service */
  auth: process.env.NEXT_PUBLIC_FF_AUTH === "true",

  /** Extension: real-time URL checking on page navigation */
  urlGuard: process.env.NEXT_PUBLIC_FF_URL_GUARD === "true",

  /** Extension: Facebook ad scanning + marketplace trust scoring.
   *  Must match the client-side build-time flag WXT_FACEBOOK_ADS. When off,
   *  /api/extension/analyze-ad returns 503 even for authenticated requests —
   *  defence in depth in case the extension bundle is unpacked and the
   *  endpoint is probed directly with a valid install-id signature. */
  facebookAds: process.env.NEXT_PUBLIC_FF_FACEBOOK_ADS === "true",

  /** Mobile: scam alert push notifications */
  pushAlerts: process.env.NEXT_PUBLIC_FF_PUSH_ALERTS === "true",

  /** Mobile: regulator-alerts feed surfaced via /api/mobile/regulator-alerts.
   *  Default OFF until the mobile app's RegulatorAlertsScreen ships in a
   *  later Expo release — keeping the endpoint dark prevents an OTA-updated
   *  client from hitting it before the UI is ready. */
  mobileRegulatorAlerts:
    process.env.NEXT_PUBLIC_FF_MOBILE_REGULATOR_ALERTS === "true",

  /** Mobile: device attestation (Play Integrity / App Attest) */
  deviceAttestation: process.env.NEXT_PUBLIC_FF_DEVICE_ATTEST === "true",

  /** Mobile: offline scam database via SQLite */
  offlineDB: process.env.NEXT_PUBLIC_FF_OFFLINE_DB === "true",

  /** Mobile: Android call screening service */
  callScreening: process.env.NEXT_PUBLIC_FF_CALL_SCREEN === "true",

  /** Mobile: iOS SMS filtering extension */
  smsFilter: process.env.NEXT_PUBLIC_FF_SMS_FILTER === "true",

  /** Family protection plan: shared dashboard + activity log */
  familyPlan: process.env.NEXT_PUBLIC_FF_FAMILY_PLAN === "true",

  /** Public scam feed: browsable threat intelligence from Reddit, verified scams, user reports */
  scamFeed: process.env.NEXT_PUBLIC_FF_SCAM_FEED === "true",

  /** B2B multi-tenancy: organizations, team management, org-scoped dashboards */
  multiTenancy: process.env.NEXT_PUBLIC_FF_MULTI_TENANCY === "true",

  /** Corporate onboarding flow with ABN verification */
  corporateOnboarding: process.env.NEXT_PUBLIC_FF_CORPORATE_ONBOARDING === "true",

  /** Phase 14 Sprint 2: Claude Haiku enrichment of vulnerabilities.au_context
   *  (banks_affected, gov_affected, essential_eight_relevance, cps234_relevance).
   *  Keep OFF until PR B3's $5/day cost brake is live — the enrichment fans
   *  out to every new CVE so a large NVD catch-up can spend quickly. */
  vulnAuEnrichment: process.env.NEXT_PUBLIC_FF_VULN_AU_ENRICHMENT === "true",

  /** Phase 2 of the /api/analyze refactor: route emits analyze.completed.v1
   *  and durable Inngest consumers take over scam_reports writes, brand
   *  alerts, and cost telemetry. When OFF, falls back to the legacy
   *  waitUntil block. Server-side only (no NEXT_PUBLIC_ prefix) — this
   *  controls backend routing, not client UI. */
  analyzeInngestWeb: readBoolEnv("FF_ANALYZE_INNGEST_WEB"),

  /** Phone Footprint — consumer product (free teaser + paid self-lookup).
   *  Client-side NEXT_PUBLIC_ so the UI can conditionally render entry
   *  points. Default OFF until Sprint 2 end-to-end testing green. */
  phoneFootprintConsumer:
    process.env.NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER === "true",

  /** Phone Footprint — Vonage provider (NI v2 fraud_score + CAMARA SIM Swap
   *  + Device Swap). Server-side only — never exposed to the browser because
   *  the Vonage API key is a server secret. Default OFF until VONAGE_API_KEY
   *  + VONAGE_API_SECRET are set and the provider has been dry-tested.
   *  When OFF, pillar 3 falls back to IPQS and pillar 4 reports
   *  `available: false` so the scorer redistributes weight. */
  vonageEnabled: readBoolEnv("FF_VONAGE_ENABLED"),

  /** Phone Footprint — LeakCheck phone-breach lookup. Server-side only.
   *  Default OFF until LeakCheck DPA is signed with APP-equivalent clauses
   *  (APP 8 — overseas disclosure). When OFF, pillar 2 (breach) either
   *  falls back to HIBP email-only coverage or reports `available: false`. */
  leakcheckEnabled: readBoolEnv("FF_LEAKCHECK_ENABLED"),

  /** Phone Footprint — Twilio Verify OTP for phone ownership proof.
   *  Server-side only. Default OFF until TWILIO_VERIFY_SERVICE_SID is
   *  provisioned in the Twilio console AND the /verify/{start,check}
   *  endpoints have been tested end-to-end. This is the APP 3.5/3.6
   *  compliance spine — the paid-tier lookup route falls back to
   *  teaser-only output when OFF. */
  twilioVerifyEnabled: readBoolEnv("FF_TWILIO_VERIFY_ENABLED"),

  // ===========================================================================
  // Breach Defence Suite — gates each feature in the F1–F11 build. Default OFF
  // until the corresponding migration + route + UI ship and the smoke test
  // listed in the source spec passes. Each flag gates *consumer-visible*
  // surfaces; back-end Inngest crons run on their own schedule and are gated
  // by env-var presence, not these flags.
  // ===========================================================================

  /** Breach Defence F1 — DNS / SPF / DMARC / NS drift monitor for watched
   *  domains. Gates the /dashboard/domains UI and email/webhook fan-out. The
   *  bd-dns-drift Inngest cron runs whenever the function is registered. */
  bdDnsDrift: process.env.NEXT_PUBLIC_FF_BD_DNS_DRIFT === "true",

  /** Breach Defence F4 — public Australian Breach Index (/breach index page,
   *  /breach/[slug] companion pages, /api/breach/lookup). Gate stays OFF until
   *  ≥30 historical breaches are reviewed and is_published=true in v80. */
  bdBreachIndex: process.env.NEXT_PUBLIC_FF_BD_BREACH_INDEX === "true",

  /** Breach Defence F2 — browser-extension proactive breach warning ribbon.
   *  Server-side gate paired with the WXT build-time WXT_BD_BREACH_WARNING
   *  flag; both must be on for the ribbon to render. */
  bdExtensionWarning: process.env.NEXT_PUBLIC_FF_BD_EXTENSION_WARNING === "true",

  /** Breach Defence F3 — auto-rotate compromised credentials via password-
   *  manager deep links (1Password / Bitwarden / Apple Keychain). Gates the
   *  rotateActions array in the /api/breach-check response and the UI button
   *  list on the breach-check page. */
  bdPwdRotate: process.env.NEXT_PUBLIC_FF_BD_PWD_ROTATE === "true",

  /** Breach Defence F5 — B2B aggregated breach exposure endpoint at
   *  /api/v1/breach/exposure. Gates the route entirely (returns 503 when off);
   *  validateApiKey is checked first regardless. */
  bdB2bExposure: process.env.NEXT_PUBLIC_FF_BD_B2B_EXPOSURE === "true",

  /** Breach Defence F6 — class-action awareness alerts ("Arthur Class Watch").
   *  Gates /class-actions portal, subscribe flow, and email fan-out. The
   *  AusLII / OAIC / firm-portal scrapers run independently of this flag. */
  bdClassActions: process.env.NEXT_PUBLIC_FF_BD_CLASS_ACTIONS === "true",

  /** Breach Defence F7 — "Arthur Aftermath" per-breach companion page wiring.
   *  Gates the embedded recovery wizard, second-wave feed, class action card,
   *  and subscribe form on /breach/[slug]. Independent of bdBreachIndex (the
   *  page renders without these sections when the flag is off). */
  bdAftermath: process.env.NEXT_PUBLIC_FF_BD_AFTERMATH === "true",

  /** Breach Defence F8 — typosquat / lookalike domain pre-registration
   *  alerter. Gates /dashboard/brands, the bd-typosquat-cron, and the auDA
   *  takedown template generator. WHOIS spend is capped per-customer in
   *  cost-telemetry; pausing here also pauses spend. */
  bdTyposquat: process.env.NEXT_PUBLIC_FF_BD_TYPOSQUAT === "true",

  /** Breach Defence F9 — embeddable Breach Score badge (A+→F grade).
   *  Gates the /api/breach-score/[domain] SVG endpoint and the public
   *  /breach-score landing page. The score-compute Inngest function runs
   *  on its own schedule. */
  bdBreachScore: process.env.NEXT_PUBLIC_FF_BD_BREACH_SCORE === "true",

  /** Breach Defence F10 — post-breach recovery playbooks. Gates the
   *  /recovery/[breach] wizard and the /api/recovery-playbook routes. The
   *  15 playbook JSON files are seeded at deploy regardless of this flag —
   *  the gate just hides the UI until the editorial review is complete. */
  bdRecovery: process.env.NEXT_PUBLIC_FF_BD_RECOVERY === "true",

  /** Breach Defence F11 — second-wave phishing correlation tags on
   *  verified_scams.metadata.breach_slug. Gates rendering of the "Active
   *  scams referencing this breach" section on /breach/[slug]; the
   *  correlate cron runs whenever its function is registered. */
  bdSecondWave: process.env.NEXT_PUBLIC_FF_BD_SECOND_WAVE === "true",

  // ===========================================================================
  // Reddit Scam Intelligence — gates the narrative-extraction layer over the
  // existing daily Reddit scrape. Build sequence: pre-work → Wave 1 (ingest)
  // → Wave 2 (dashboard + email) → Wave 3 (B2B API + retention).
  // Plan: docs/plans/reddit-intel.md.
  // ===========================================================================

  /** Reddit Intel Wave 1 — daily Sonnet batch classifier + IOC linker.
   *  Gates the cron trigger that polls feed_items for unprocessed Reddit rows
   *  and the Inngest function that writes reddit_post_intel /
   *  reddit_intel_daily_summary / reddit_intel_quotes. Server-side only —
   *  this controls backend processing, not UI. Costs ~A$5-15/month at current
   *  ~270 posts/week volume; daily cost-telemetry alert set at A$50. */
  redditIntelIngest: readBoolEnv("FF_REDDIT_INTEL_INGEST"),

  /** Reddit Brands Discover — weekly cron that aggregates
   *  reddit_post_intel.brands_impersonated, resolves via the v174 alias layer,
   *  drops already-watched brands, and writes the unwatched remainder to
   *  reddit_watchlist_candidates + a Telegram digest. Feeds the human
   *  watchlist-curation loop; never auto-mutates the clone-watch monitored set.
   *  Server-side only; no paid API → no cost brake needed. */
  redditBrandsDiscover: readBoolEnv("FF_REDDIT_BRANDS_DISCOVER"),

  /** Scam-reports source for the brands-discover queue (Phase 1 of the
   *  brand-convergence-seam plan). When ON, the existing reddit-brands-discover
   *  weekly cron adds a SECOND aggregation source — brands people report to
   *  Arthur as impersonated (scam_reports.impersonated_brand, 30d window) — and
   *  upserts them into the same watchlist_candidates queue with
   *  source='scam_reports'. Gates ONLY the new source step; the Reddit source
   *  runs exactly as before when OFF. No new cron; read-only windowed aggregate
   *  over scam_reports → no cost brake needed. */
  scamBrandsSource: readBoolEnv("FF_SCAM_BRANDS_SOURCE"),

  /** Reddit Intel Wave 2 — dashboard widgets (RedditIntelPanel, theme cards,
   *  brand watchlist, theme-velocity drill-down). Independent of the ingest
   *  flag — when ingest is on but dashboard is off, data is collected but
   *  not surfaced. Safe to flip on read-side once Wave 1 has produced ≥7 days
   *  of summaries. */
  redditIntelDashboard:
    process.env.NEXT_PUBLIC_FF_REDDIT_INTEL_DASHBOARD === "true",

  /** Reddit Intel Wave 2 — weekly email digest variant sourced from
   *  reddit_intel_daily_summary. When OFF, weekly-email cron falls back to
   *  the legacy verified_scams template. Server-side only — the cron route
   *  is the only consumer. */
  redditIntelEmail: readBoolEnv("FF_REDDIT_INTEL_EMAIL"),

  /** Reddit Intel Wave 3 — public B2B API at /api/v1/intel/* (themes, digest,
   *  quotes). Returns 503 when off; validateApiKey is checked first regardless. */
  redditIntelB2bApi:
    process.env.NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API === "true",

  /** Reddit Intel — public /intel/themes/[slug] pages. Each page surfaces a
   *  single narrative cluster + its Reddit member permalinks, used as the
   *  email digest's deep-link target and a B2B trial-pitch surface. When OFF,
   *  the route returns notFound() and the email falls back to plain-text
   *  theme titles. Default OFF until a Vercel preview confirms the page
   *  renders cleanly against real prod data. */
  redditIntelPublicPages:
    process.env.NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES === "true",

  /** B2B semantic search over scam_reports + verified_scams at
   *  /api/v1/scams/search. Returns 503 when off; validateApiKey is
   *  checked first regardless. Default OFF — turn on per-deployment once
   *  the embedding backfill has run and there's enough corpus to retrieve
   *  meaningful results. */
  scamsSearchB2bApi:
    process.env.NEXT_PUBLIC_FF_SCAMS_SEARCH_B2B_API === "true",

  /** Meta Brand Rights Protection (BRP) deepfake reporter. Server-side only —
   *  the function is dormant in prod (Meta Graph API call is still a stub)
   *  but the cron fires on schedule. Flag exists so the cost brake + kill
   *  switch are wired *before* the stub is replaced with a billed Meta call.
   *  Server-side only — the Inngest cron is the only consumer. Default OFF:
   *  leave off until META_BRP_ACCESS_TOKEN is granted, the Trusted Partner
   *  application clears, and the cost-daily-check brake on
   *  feature_brakes.meta_brp is in place. */
  metaBrpReporter: readBoolEnv("FF_META_BRP_REPORTER"),

  /** Charity Legitimacy Check — consumer page (/charity-check) + main-checker
   *  deep-link CTA. Public flag so the UI can conditionally render entry
   *  points. Default OFF until the v0.1 data spine has run for ≥1 cycle
   *  (acnc_charities populated) AND the consumer surface PR has shipped. */
  charityCheck: process.env.NEXT_PUBLIC_FF_CHARITY_CHECK === "true",

  /** Charity Legitimacy Check — server-only ingest gate. When ON, the
   *  pipeline/scrapers/acnc_register.py daily run actually fetches and
   *  upserts. When OFF (or unset), the scraper logs a no-op and exits.
   *  Wired in the GitHub Actions step env *and* checked at the top of
   *  scrape() so an accidental local run is also a no-op. */
  charityCheckIngest: readBoolEnv("FF_CHARITY_CHECK_INGEST"),

  /** Phase 14 Sprint 1 closure — write public.vulnerability_detections rows
   *  from scanner runs. Currently mcp-audit only; extension-audit + skill-audit
   *  pending CVE rulepack mappings. Server-side only — controls fire-and-forget
   *  DB writes after a scan completes; never blocks the user response. Default
   *  OFF until the helper has been smoke-tested in preview. */
  vulnDetectionRecording: readBoolEnv("FF_VULN_DETECTION_RECORDING"),

  /** Phase 14 Sprint 4 — B2B exposure matcher. The match-b2b-exposure Inngest
   *  function is triggered by b2b/exposure.requested.v1 events carrying a
   *  product/version inventory; it queries vulnerabilities by affected_products
   *  overlap, runs semver.satisfies on affected_versions, writes matching rows
   *  to vulnerability_detections, and emits b2b/exposure.matched.v1 for
   *  webhook fan-out. When OFF, the function returns {skipped:true} early.
   *  Server-side only — the Inngest function is the only consumer. Default
   *  OFF until the orgId tenant-scoping is confirmed safe and the
   *  /api/v1/exposure HTTP producer (separate PR) is in place. */
  vulnB2bExposure: readBoolEnv("FF_VULN_B2B_EXPOSURE"),

  /** Round-2 audit (b) closure — render "Similar reports we've seen" under
   *  the verdict on the consumer scan flow. The /api/analyze/similar route,
   *  match_scam_reports_hybrid RPC (v95), and Voyage rerank-2.5-lite are
   *  already live; this gates the UI consumer only. SAFE verdicts skip the
   *  surface (it's only useful for SUSPICIOUS / HIGH_RISK). Default OFF
   *  until preview smoke-test confirms latency budget and zero PII leak. */
  similarReports: process.env.NEXT_PUBLIC_FF_SIMILAR_REPORTS === "true",

  /** Round-2 audit (f) — inject top-K recent reddit_intel_themes into the
   *  Haiku system prompt at /api/analyze time. Adds one Voyage embedQuery
   *  + one match_themes_by_centroid RPC per uncached request (~$0.000003
   *  amortised). PROMPT_VERSION bumped to 2.1.0 so flipping this flag
   *  invalidates the analyze-cache. Server-side only — gates the consumer
   *  web flow specifically; extension/bot surfaces stay on the unprompted
   *  classifier. */
  ragThemes: readBoolEnv("FF_RAG_THEMES"),

  /** News Intel — fold regulator narrative search results (Scamwatch / ACSC /
   *  ASIC) into /api/v1/intel/search alongside reddit posts via the
   *  match_feed_items_narrative RPC. Default OFF for staged rollout — flip
   *  on once the corpus has had a few weeks to accrue and customers have
   *  asked for it. Server-side only — gates the API merge logic. */
  regulatorIntelSearch: readBoolEnv("FF_REGULATOR_INTEL_SEARCH"),

  /** Shop Guard Stage 0 — pure commerce-page detector + post-processor that
   *  extracts commerce-specific tags from Claude's existing red-flag list
   *  and attaches them as `AnalysisResult.shopSignal`. Server-side only:
   *  the consumer surfaces (ResultCard chips, bot-formatter summary line)
   *  render unconditionally when the field is present, so flipping this
   *  flag end-to-end requires only the one server env. Default OFF until
   *  preview smoke-test confirms the taxonomy hits ≥30% of commerce-shaped
   *  fixtures. Plan: docs/plans/shop-guard-v2.md §3. */
  shopSignal: readBoolEnv("FF_SHOP_SIGNAL"),

  /** Shop Guard Stage 1 — enables the APIVoid Site Trustworthiness paid
   *  feed. Independent of `shopSignal` so the free Stage-0 detector keeps
   *  running if the paid feed is in trouble. Server-side only. Default OFF
   *  until the APIVoid trial-key preview smoke test passes; flip ON to
   *  start consuming the trial. Plan: docs/plans/shop-guard-v2.md §4 PR 2. */
  shopSignalPaidFeed: readBoolEnv("FF_SHOP_SIGNAL_PAID_FEED"),

  /** Shop Guard Stage 1 — on-page review-authenticity signal. Detects the
   *  store's review app (Okendo / Judge.me / Loox / Yotpo), reads its public
   *  data endpoint, and runs a free deterministic distribution check
   *  (implausible star spread, review velocity vs domain age). Server-side
   *  only (the Inngest enrichment worker is the only consumer). Independent of
   *  `shopSignalPaidFeed` — the free layer runs even if APIVoid is in trouble.
   *  Default OFF until the PR 2 live-probe confirms the per-app extractors.
   *  Plan: docs/plans/shop-guard-v2.md — reviews addendum. */
  shopSignalReviews: readBoolEnv("FF_SHOP_SIGNAL_REVIEWS"),

  /** Shop Guard Stage 1 — the paid Claude language pass over sampled review
   *  text that corroborates the deterministic review check into a
   *  `manipulated` verdict. Gated separately (and by isFeatureBraked(
   *  "shop_signal_reviews") + REVIEWS_LLM_CAP_USD) so the free distribution
   *  layer can run with this dark. Server-side only. Default OFF until the
   *  cap/brake are canaried. Plan: docs/plans/shop-guard-v2.md — reviews. */
  shopSignalReviewsLlm: readBoolEnv("FF_SHOP_SIGNAL_REVIEWS_LLM"),

  /** Shopfront clone-watch Layer 0 — daily NRD lexical sweep against the
   *  static AU brand watchlist. Server-side only (the Inngest function is
   *  the only consumer). Default OFF until WHOISDS_NRD_ZIP_URL is set in
   *  Vercel + the post-merge prod smoke verifies the first run produces
   *  rows + Telegram digest. Plan: docs/plans/clone-watch-mvp.md §4 PR 2. */
  shopfrontCloneWatch: readBoolEnv("FF_SHOPFRONT_CLONE_WATCH"),

  /** Brand Stewardship Report — monthly per-brand rollup over onward_report_log
   *  ("here's what we detected + reported on your behalf this month"). Gates
   *  the report-brand-stewardship cron (aggregation + ledger) AND the
   *  brand-facing send route. Server-side only. Default OFF until the email
   *  template's framing is legal-reviewed (#371) and the first month's
   *  prepared rows have been eyeballed via the admin dashboard. */
  brandStewardshipReport: readBoolEnv("FF_BRAND_STEWARDSHIP_REPORT"),

  /** Admin clone-summary digest — extends the existing clone-watch internal
   *  digest into a Scamwatch-submission aid: ALL clone URLs per brand + a
   *  "registrars that provided them" rollup (with abuse emails) + a bounded
   *  Telegram summary. Operator-only (the existing shadow recipient); never
   *  emailed to ACCC/ACMA (Scamwatch has no intake). Server-side only. Default
   *  OFF — when off, the internal digest renders byte-identical to today. */
  adminCloneSummaryDigest: readBoolEnv("FF_ADMIN_CLONE_SUMMARY_DIGEST"),

  /** Brand Stewardship Report — REAL brand-recipient sends. Gates the admin
   *  send route from emailing the actual brand security contact. Hard
   *  precondition: #371 legal sign-off of the outreach copy. Default OFF.
   *  NOTE: this flag is BYPASSED when BRAND_STEWARDSHIP_SHADOW_RECIPIENT is set
   *  — shadow sends go to our own inbox for validation and carry no
   *  defamation/legal risk, so they don't need #371. Server-side only. */
  brandStewardshipSend: readBoolEnv("FF_BRAND_STEWARDSHIP_SEND"),

  /** Onward reporting — OpenPhish community blocklist destination. Server-side
   *  only (the Inngest worker is the only consumer). Gates the
   *  report-onward-openphish worker: when OFF the worker marks the queued log
   *  row skipped instead of emailing report@openphish.com. Default OFF until
   *  the forward template is validated + RESEND deliverability to OpenPhish is
   *  confirmed. */
  onwardOpenphish: readBoolEnv("FF_ONWARD_OPENPHISH"),

  /** Onward reporting — APWG eCrime Exchange destination
   *  (reportphishing@apwg.org). Server-side only. Gates the
   *  report-onward-apwg worker; same skip-when-OFF semantics as OpenPhish.
   *  Default OFF. */
  onwardApwg: readBoolEnv("FF_ONWARD_APWG"),

  /** Onward reporting — proactive auto-report producer. When ON, the hourly
   *  onward-auto-report cron sweeps recent HIGH_RISK scam_reports that carry a
   *  scammer URL and enqueues onward reports to the enabled URL-blocklist
   *  destinations (OpenPhish / APWG) WITHOUT waiting for a user to click. This
   *  is the "report on behalf of brands without being asked" path. Server-side
   *  only. Default OFF. Composes with the per-destination flags: the producer
   *  only enqueues a destination whose own worker flag (onwardOpenphish /
   *  onwardApwg) is ON, so no skipped rows are generated for dark destinations,
   *  and sending is gated twice (producer flag + worker flag). */
  onwardAutoReport: readBoolEnv("FF_ONWARD_AUTO_REPORT"),

  /** Onward reporting — ACMA spam intake destination
   *  (report@submit.spam.acma.gov.au). Server-side only. Gates the
   *  report-onward-acma-email-spam worker so the destination can be darkened
   *  without a deploy (matches the OpenPhish/APWG skip-when-OFF semantics).
   *  Default OFF. */
  onwardAcma: readBoolEnv("FF_ONWARD_ACMA"),

  /** CT monitor expanded keyword set — when ON, ct-monitor.ts sweeps crt.sh
   *  for the research-driven concentrated AU target brands (super funds,
   *  Linkt, energy retailers, Macquarie/Optus/Vodafone, Medibank/Bupa, Qantas,
   *  Afterpay, NDIS, etc.) in addition to the original `core` 9. Server-side
   *  only (the Inngest cron is the only consumer). Default OFF so the
   *  expansion is a reversible flag flip — when OFF the monitor's behaviour is
   *  byte-identical to the pre-expansion hardcoded keyword list. Keyword set +
   *  legit-domain exclusions are derived from the shared AU brand watchlist
   *  via getCtMonitorConfig. Flip ON after confirming the larger keyword set
   *  stays inside crt.sh's free-use tolerance on the 12h cadence. */
  ctMonitorExpanded: readBoolEnv("FF_CT_MONITOR_EXPANDED"),

  /** Shopfront clone-watch outreach — master flag for Layers 1-5
   *  (admin triage dashboard, community submission, brand notification,
   *  weekly digest). Server-side only. When OFF, /admin/clone-watch
   *  returns notFound() and all downstream Inngest functions short-circuit.
   *  Default OFF. Plan: docs/plans/clone-watch-outreach.md. */
  shopfrontCloneOutreach: readBoolEnv("FF_SHOPFRONT_CLONE_OUTREACH"),

  /** Layer 2 — Netcraft community submission. Server-side only. Gates the
   *  shopfront-clone-submit-netcraft Inngest fn. Independent of the
   *  master shopfrontCloneOutreach flag so the brand-notification path can
   *  ship before Netcraft API access is provisioned. Default OFF until
   *  NETCRAFT_REPORT_API_KEY is set in Vercel. */
  shopfrontCloneSubmitNetcraft: readBoolEnv(
    "FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT",
  ),

  /** Auto-report high-confidence branded clones to Netcraft WITHOUT waiting
   *  for manual triage. Gates the clone-watch-netcraft-auto producer cron,
   *  which emits one shopfront/clone.netcraft-auto.v1 per gated candidate
   *  (preclassifier is_clone AND confidence ≥ threshold, branded, not in the
   *  FP denylist, not already submitted); the existing submit-netcraft worker
   *  (dedup + denylist + rate-limit) does the submission. Default OFF — flip
   *  only after the dry-run count is reviewed. Netcraft re-verifies before any
   *  blocklisting, so good-faith over-reporting of likely clones is safe. */
  shopfrontCloneNetcraftAuto: readBoolEnv("FF_SHOPFRONT_CLONE_NETCRAFT_AUTO"),

  /** Layer 3+4 — brand-direct notification. Server-side only. Gates the
   *  shopfront-clone-notify-brand Inngest fn. Default OFF until
   *  brand_contact_directory is seeded for the full watchlist and the
   *  manual-approval gate has been calibrated. */
  shopfrontCloneNotifyBrand: readBoolEnv("FF_SHOPFRONT_CLONE_NOTIFY_BRAND"),

  /** Auto-triage the confident, still-live clone tail (clone-watch-auto-triage
   *  Inngest fn) — auto-confirms alerts that clear the strict bar (Haiku≥0.9 +
   *  confusable/levenshtein + urlscan likely_phishing) AND pass a liveness
   *  re-fetch, so operators stop clicking through the obvious cases. Sends the
   *  alert email only to CLONE_WATCH_SHADOW_RECIPIENT (validation); real-brand
   *  auto-send stays the #371-gated path. Default OFF. Server-side only. */
  cloneWatchAutoTriage: readBoolEnv("FF_CLONE_WATCH_AUTO_TRIAGE"),

  /** Cross-stream corroboration priority in the clone-watch triage queue
   *  (Phase 2 of the brand-convergence-seam plan). When ON, the admin pending-
   *  triage list passes p_corroboration_priority=true so alerts whose brand is
   *  also live in the watchlist-candidate queue (Reddit + reported scams) sort
   *  to the top. The corroboration columns are ALWAYS returned; this flag only
   *  reorders — it never touches the deterministic clone severity (ADR-0015).
   *  Default OFF. Server-side only. */
  cloneTriageCorroboration: readBoolEnv("FF_CLONE_TRIAGE_CORROBORATION"),

  /** Analyze-verdict clone citation (Phase 2b of the brand-convergence-seam
   *  plan). When ON, /api/analyze checks each submitted URL against the
   *  clone-watch list (by url_hash, existing index) and, for an operator-
   *  CONFIRMED clone only (tp_confirmed/tp_actioned — never a raw lexical
   *  match), adds a red flag citing the impersonated domain. Closes the loop:
   *  the background NRD/CT sweep pays off in a real user check. Only phase that
   *  changes user-facing output → canary separately. Default OFF. */
  analyzeCloneCitation: readBoolEnv("FF_ANALYZE_CLONE_CITATION"),

  /** Brand Register — the "brand 360" rollup (Phase 3 of the brand-convergence-
   *  seam plan). Gates BOTH the nightly brand-register-refresh Inngest fn (when
   *  OFF the cron no-ops) AND the /admin/brand-register page. One row per
   *  canonical brand with 30-day scam/reddit/clone counts + watchlist + curation
   *  state. Pure-derived, rebuilt nightly; DROP TABLE is lossless. Default OFF. */
  brandRegister: readBoolEnv("FF_BRAND_REGISTER"),

  /** Quiet the daily NRD-sweep Telegram digest (shopfront-nrd-daily-ingest).
   *  OPT-IN: default OFF preserves the current digest. Set true once the
   *  auto-triage run-summary email replaces it as the operator's notification,
   *  so Telegram stops being noisy after every match. Server-side only. */
  cloneWatchTelegramQuiet: readBoolEnv("FF_CLONE_WATCH_TELEGRAM_QUIET"),

  /** Enrich tp_confirmed clones with an attribution dossier — WHOIS (registrar /
   *  created / registrant country), Certificate-Transparency siblings (campaign
   *  clustering), and IP abuse reputation — reusing existing scam-engine helpers
   *  (clone-watch-enrich-attribution Inngest fn). Stored in
   *  shopfront_clone_alerts.attribution (v177). Default OFF. Server-side only. */
  cloneWatchAttribution: readBoolEnv("FF_CLONE_WATCH_ATTRIBUTION"),

  /** Feed CONFIRMED clones (domain + hosting IP) into the unified scam_entities
   *  index so the consumer reputation lookup / scam-map / B2B feeds see them.
   *  BLAST-RADIUS: scam_entities powers consumer-facing reputation — only
   *  strict-bar/operator-confirmed clones reach this. Default OFF; keep off
   *  until the clone-watch FP rate is validated. Server-side only. */
  cloneWatchFeedEntities: readBoolEnv("FF_CLONE_WATCH_FEED_ENTITIES"),

  /** PR-B2 — auto-approve brand notifications instead of requiring an
   *  admin click in Telegram. Default OFF: every batch shows up as a
   *  Telegram preview with an HMAC-signed approve URL; the admin clicks
   *  it to trigger the actual Resend send. Flip this ON once the
   *  template has been validated through several real batches and the
   *  brand-team response shape is well-understood. */
  shopfrontCloneNotifyBrandAutoSend: readBoolEnv(
    "FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND",
  ),

  /** Layer 5 — weekly digest Inngest cron + LinkedIn-post draft via
   *  Telegram. Server-side only. Default OFF until first triage week
   *  produces enough signal to publish. */
  shopfrontCloneWeeklyDigest: readBoolEnv("FF_SHOPFRONT_CLONE_WEEKLY_DIGEST"),

  /** Phase A.3 — urlscan.io auto-scan + auto-classification for new
   *  clone-watch candidates. Free tier (100/day) is plenty for our
   *  ~5-10 daily candidates plus a re-scan cron. Server-side only.
   *  Gates the two Inngest functions (clone-watch-urlscan + clone-watch-
   *  urlscan-rescan). Independent of the master shopfrontCloneOutreach
   *  flag so we can canary urlscan before turning on the outreach
   *  consumers. Plan: docs/plans/clone-watch-outreach.md §15 Phase A.3. */
  shopfrontCloneUrlscan: readBoolEnv("FF_SHOPFRONT_CLONE_URLSCAN"),

  /** PR-D2 (#498) — Haiku 4.5 pre-classifier for clone-watch candidates.
   *  Server-side only. Gates the clone-watch-haiku-preclassify Inngest fn.
   *  When ON, every new NRD candidate gets a Haiku classification stored
   *  in clone_watch_classifications (sibling table). Pending-queue order
   *  is then pre-ranked by confidence. Default OFF — canary independently
   *  of the master shopfrontCloneOutreach flag.
   *  Cost: ~$0.01–0.02/call × ~7 hits/day = ~$0.07/day. Spend is rolled
   *  into the shared `SHOPFRONT_CLONE_OUTREACH_CAP_USD` aggregate brake
   *  (default $5/day) via cost-daily-check — no dedicated per-feature cap.
   *  See PR-H (local-ultrareview F1) for the aggregator wiring. */
  shopfrontClonePreclassify: readBoolEnv("FF_SHOPFRONT_CLONE_PRECLASSIFY"),

  /** Screenshot retention — when ON, `storeVerifiedScam` uploads the raw
   *  screenshot of a HIGH_RISK image submission to R2. Default OFF, and it
   *  must stay OFF until prerequisites are met: `scrubPII` is text-only, so
   *  a stored screenshot is unredacted raw user content (faces, bank-app
   *  screens, IDs). Enabling requires OCR-based PII redaction OR a consent
   *  path, plus legal review, the R2 `screenshots/` lifecycle rule, a
   *  privacy-policy update, and upload-failure observability. Server-side
   *  only. See docs/adr/0010-screenshot-retention-gated.md. */
  screenshotRetention: readBoolEnv("FF_SCREENSHOT_RETENTION"),

  /** Clone Watch owned-media public surface — makes the pillar, monthly index
   *  (/clone-watch/[period]) and methodology pages indexable + sitemap-listed +
   *  cross-linked. Client-visible (NEXT_PUBLIC_) so pages can flip their
   *  `robots` meta and conditionally render cross-links. Default OFF: the routes
   *  render behind `noindex` regardless, but going PUBLIC waits on #371's
   *  lawyer-vetted copy. Flip to true (with the vetted copy) to launch. */
  cloneWatchPublic: process.env.NEXT_PUBLIC_FF_CLONE_WATCH_PUBLIC === "true",

  /** Clone Watch lead magnet — the /api/clone-list-request endpoint that emails
   *  a requester their brand's suspected-lookalike CSV. Server-only, default
   *  OFF. Kept DARK until founder sign-off on the sensitivity: any work email
   *  can request any brand's list (mitigations: work-email gate, rate-limit,
   *  tp_confirmed-only "suspected lookalikes for review" framing, and the
   *  clone_watch_disputes correction process). Decoupled from the public-pages
   *  flag so the endpoint can't go live implicitly. */
  cloneListRequest: readBoolEnv("FF_CLONE_LIST_REQUEST"),

  /** First-party analytics + inbound first-touch attribution. When ON, the
   *  middleware sets the write-once `aa_attribution` cookie (anonymous_id +
   *  first-touch UTMs/referrer) and the logEvent() writer + /api/events route
   *  persist named events to analytics_events (v190). Server-side only — gates
   *  the middleware cookie write and the event-ingestion path, not any client
   *  UI. Default OFF until the v190 schema is applied and preview verification
   *  passes; then canary ON. Zero paid-API spend → no cost brake needed. */
  analyticsAttribution: readBoolEnv("FF_ANALYTICS_ATTRIBUTION"),
} as const;

export type FeatureFlag = keyof typeof featureFlags;
