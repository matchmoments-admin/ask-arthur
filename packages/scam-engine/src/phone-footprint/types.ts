// Canonical type definitions for the Phone Footprint product.
//
// Types live here (not in @askarthur/types) because they are internal to the
// scam-engine package and the orchestrator/scorer are the only consumers.
// The API route imports Footprint and FootprintRequestContext via the
// phone-footprint barrel and re-projects to a wire format in the route.

/** Five pillars feeding the composite risk score. */
export type PillarId =
  | "scam_reports" // 1. internal scam_reports + clusters
  | "breach" // 2. LeakCheck phone + HIBP email (opt)
  | "reputation" // 3. Vonage fraud_score (primary) + IPQS (fallback)
  | "sim_swap" // 4. Vonage CAMARA SIM Swap + Device Swap
  | "identity"; // 5. Twilio line_type + CNAM

/** Per-pillar output from a provider. */
export interface PillarResult {
  id: PillarId;
  /** 0..100, higher = more risk. */
  score: number;
  /** 0..1. Used by the scorer when blending fallback providers. */
  confidence: number;
  /** If false, scorer redistributes this pillar's weight across available ones. */
  available: boolean;
  /** Short machine-readable reason for `available = false`, if applicable. */
  reason?: string;
  /** Raw/structured detail. Redacted out of the response for teaser tier. */
  detail?: Record<string, unknown>;
}

/** Which output depth a caller is entitled to. */
export type FootprintTier = "teaser" | "basic" | "full";

/** Per-provider coverage status surfaced to the UI. */
export interface Coverage {
  /** 'live' once CAMARA SIM Swap is granted; 'pending' while Aduna/Telstra
   *  approval is still in flight; 'degraded' on transient errors; 'disabled'
   *  when FF_VONAGE_ENABLED is false. */
  vonage: "live" | "pending" | "degraded" | "disabled";
  /** 'live' once DPA signed + API key set; 'disabled' otherwise. */
  leakcheck: "live" | "disabled" | "degraded";
  /** 'live' (primary reputation), 'fallback' (used because Vonage missed),
   *  'degraded' on errors, 'disabled' when IPQS key missing. */
  ipqs: "live" | "fallback" | "degraded" | "disabled";
  /** 'live' | 'degraded' for Twilio Lookup. */
  twilio: "live" | "degraded";
  /** 'live' | 'degraded' for the internal Supabase RPC. */
  internal: "live" | "degraded";
}

/** Final composite footprint returned to API callers. */
export interface Footprint {
  msisdn_e164: string;
  msisdn_hash: string;
  tier: FootprintTier;
  composite_score: number;
  band: "safe" | "caution" | "high" | "critical";
  pillars: Record<PillarId, PillarResult>;
  coverage: Coverage;
  providers_used: string[];
  explanation: string | null;
  generated_at: string;
  expires_at: string;
  request_id?: string;
}

/** Minimal shape consumed by the orchestrator at the API/route boundary. */
export interface FootprintRequestContext {
  tier: FootprintTier;
  userId?: string;
  orgId?: string;
  requestId?: string;
  /** Whether the caller has proven ownership of the queried number (OTP
   *  verified, org fleet attestation, or entity already publicly attributed
   *  to a verified scam). Used by the scorer's redactForFree. */
  ownershipProven: boolean;
  /** Optional linked email for pillar 2's HIBP leg. Not required. */
  emailForBreach?: string;
}

/** Alert delta emitted by delta.ts after a monthly refresh. */
export type AlertType =
  | "band_change"
  | "score_delta"
  | "new_breach"
  | "new_scam_reports"
  | "sim_swap"
  | "carrier_change"
  | "fraud_score_delta";

export interface FootprintDelta {
  type: AlertType;
  severity: "info" | "warning" | "critical";
  detail: Record<string, unknown>;
}
