// Database-facing types for site audit storage

export interface StoredSite {
  id: number;
  domain: string;
  normalized_url: string;
  first_scanned_at: string;
  last_scanned_at: string;
  latest_grade: string | null;
  latest_score: number | null;
  scan_count: number;
  badge_eligible: boolean;
  badge_token: string | null;
}

export interface StoredSiteAudit {
  id: number;
  site_id: number;
  overall_score: number;
  grade: string;
  test_results: Record<string, unknown>;
  category_scores: Record<string, unknown>;
  recommendations: string[];
  duration_ms: number | null;
  scanned_at: string;
}
