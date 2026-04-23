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
} as const;

export type FeatureFlag = keyof typeof featureFlags;
