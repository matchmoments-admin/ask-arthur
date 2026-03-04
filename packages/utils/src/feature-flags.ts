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

  /** Paddle billing — pricing page and checkout */
  billing: process.env.NEXT_PUBLIC_FF_BILLING === "true",

  /** User auth, dashboard, and API key self-service */
  auth: process.env.NEXT_PUBLIC_FF_AUTH === "true",

  /** Extension: real-time URL checking on page navigation */
  urlGuard: process.env.NEXT_PUBLIC_FF_URL_GUARD === "true",

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
} as const;

export type FeatureFlag = keyof typeof featureFlags;
