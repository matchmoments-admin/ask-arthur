// Intelligence Core types — unified reports, entities, and linkage.
// Maps to tables created in migration-v21 and migration-v22.

export type ReportSource =
  | "web"
  | "extension"
  | "mobile"
  | "bot_telegram"
  | "bot_whatsapp"
  | "bot_slack"
  | "bot_messenger"
  | "api";

export type InputMode = "text" | "image" | "qrcode" | "email";

export type EntityType =
  | "phone"
  | "email"
  | "url"
  | "domain"
  | "ip"
  | "crypto_wallet"
  | "bank_account";

export type ExtractionMethod = "regex" | "claude" | "ocr" | "manual" | "feed";

export type EntityRole =
  | "sender"
  | "recipient"
  | "mentioned"
  | "payment_target"
  | "redirect_target";

export type ClusterType =
  | "entity_overlap"
  | "text_similarity"
  | "brand_campaign"
  | "manual";

export type ClusterStatus = "active" | "dormant" | "disrupted";

export interface ScamReport {
  id: number;
  reporter_hash: string;
  source: ReportSource;
  input_mode: InputMode | null;
  verdict: "SAFE" | "SUSPICIOUS" | "HIGH_RISK";
  confidence_score: number;
  scam_type: string | null;
  channel: string | null;
  delivery_method: string | null;
  impersonated_brand: string | null;
  scrubbed_content: string | null;
  analysis_result: Record<string, unknown>;
  verified_scam_id: number | null;
  region: string | null;
  country_code: string | null;
  cluster_id: number | null;
  created_at: string;
}

export type EnrichmentStatus =
  | "none"
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface ScamEntity {
  id: number;
  entity_type: EntityType;
  normalized_value: string;
  raw_value: string | null;
  canonical_entity_id: number | null;
  canonical_entity_table: string | null;
  report_count: number;
  first_seen: string;
  last_seen: string;
  created_at: string;
  // v23: Enrichment
  enrichment_status: EnrichmentStatus;
  enrichment_data: Record<string, unknown>;
  enriched_at: string | null;
  enrichment_error: string | null;
  // v24: Risk scoring
  risk_score: number;
  risk_level: RiskLevel;
  risk_factors: Record<string, unknown>;
  risk_scored_at: string | null;
}

export interface ReportEntityLink {
  id: number;
  report_id: number;
  entity_id: number;
  extraction_method: ExtractionMethod;
  role: EntityRole;
  created_at: string;
}

export interface ScamCluster {
  id: number;
  cluster_type: ClusterType;
  primary_scam_type: string | null;
  primary_brand: string | null;
  member_count: number;
  entity_count: number;
  total_loss: number;
  status: ClusterStatus;
  metadata: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  created_at: string;
}

export interface ClusterMember {
  id: number;
  cluster_id: number;
  report_id: number;
  created_at: string;
}
