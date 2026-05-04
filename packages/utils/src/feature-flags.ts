// Feature flags — env-var-based, toggleable via Vercel dashboard.
// NEXT_PUBLIC_ prefix makes these available on both server and client.
// Default: all OFF. Enable incrementally as each capability is verified.

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
  analyzeInngestWeb: process.env.FF_ANALYZE_INNGEST_WEB === "true",

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
  vonageEnabled: process.env.FF_VONAGE_ENABLED === "true",

  /** Phone Footprint — LeakCheck phone-breach lookup. Server-side only.
   *  Default OFF until LeakCheck DPA is signed with APP-equivalent clauses
   *  (APP 8 — overseas disclosure). When OFF, pillar 2 (breach) either
   *  falls back to HIBP email-only coverage or reports `available: false`. */
  leakcheckEnabled: process.env.FF_LEAKCHECK_ENABLED === "true",

  /** Phone Footprint — Twilio Verify OTP for phone ownership proof.
   *  Server-side only. Default OFF until TWILIO_VERIFY_SERVICE_SID is
   *  provisioned in the Twilio console AND the /verify/{start,check}
   *  endpoints have been tested end-to-end. This is the APP 3.5/3.6
   *  compliance spine — the paid-tier lookup route falls back to
   *  teaser-only output when OFF. */
  twilioVerifyEnabled: process.env.FF_TWILIO_VERIFY_ENABLED === "true",

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
  redditIntelIngest: process.env.FF_REDDIT_INTEL_INGEST === "true",

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
  redditIntelEmail: process.env.FF_REDDIT_INTEL_EMAIL === "true",

  /** Reddit Intel Wave 3 — public B2B API at /api/v1/intel/* (themes, digest,
   *  quotes). Returns 503 when off; validateApiKey is checked first regardless. */
  redditIntelB2bApi:
    process.env.NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API === "true",

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
   *  Default OFF: leave off until META_BRP_ACCESS_TOKEN is granted, the
   *  Trusted Partner application clears, and the cost-daily-check brake on
   *  feature_brakes.meta_brp is in place. */
  metaBrpReporter: process.env.FF_META_BRP_REPORTER === "true",

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
  charityCheckIngest: process.env.FF_CHARITY_CHECK_INGEST === "true",

  /** Phase 14 Sprint 1 closure — write public.vulnerability_detections rows
   *  from scanner runs. Currently mcp-audit only; extension-audit + skill-audit
   *  pending CVE rulepack mappings. Server-side only — controls fire-and-forget
   *  DB writes after a scan completes; never blocks the user response. Default
   *  OFF until the helper has been smoke-tested in preview. */
  vulnDetectionRecording: process.env.FF_VULN_DETECTION_RECORDING === "true",

  /** Phase 14 Sprint 4 — B2B exposure matcher. The match-b2b-exposure Inngest
   *  function is triggered by b2b/exposure.requested.v1 events carrying a
   *  product/version inventory; it queries vulnerabilities by affected_products
   *  overlap, runs semver.satisfies on affected_versions, writes matching rows
   *  to vulnerability_detections, and emits b2b/exposure.matched.v1 for
   *  webhook fan-out. When OFF, the function returns {skipped:true} early.
   *  Default OFF until the orgId tenant-scoping is confirmed safe and the
   *  /api/v1/exposure HTTP producer (separate PR) is in place. */
  vulnB2bExposure: process.env.FF_VULN_B2B_EXPOSURE === "true",
} as const;

export type FeatureFlag = keyof typeof featureFlags;
