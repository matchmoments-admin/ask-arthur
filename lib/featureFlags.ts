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
} as const;

export type FeatureFlag = keyof typeof featureFlags;
