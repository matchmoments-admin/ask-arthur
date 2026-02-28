-- Migration v26: Fix risk scoring RPC to use actual enrichment_data keys.
-- The v24 RPC checked for 'googleSafeBrowsing' and 'virustotalMalicious' keys
-- that never existed in the JSONB. This version uses the namespaced structure:
--   enrichment_data -> 'localIntel' -> { phone/email/domain/ip/url intel }
--   enrichment_data -> 'whois' -> { registrar, createdDate, isPrivate, ... }
--   enrichment_data -> 'ssl' -> { valid, issuer, daysRemaining }
--   enrichment_data -> 'safeBrowsing' -> { isMalicious, sources }
--   enrichment_data -> 'geo' -> { region, countryCode }

-- =============================================================================
-- Replace compute_entity_risk_score with fixed signal checks
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_entity_risk_score(p_entity_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entity RECORD;
  v_score INT := 0;
  v_factors JSONB := '{}';
  v_cluster_count INT;
  v_high_risk_count INT;
  v_days_since_last FLOAT;
  v_report_points INT;
  v_verdict_points INT;
  v_enrichment_points INT;
  v_cluster_points INT;
  v_recency_points INT;
  v_level TEXT;
  v_enrichment_signals JSONB := '[]';
BEGIN
  SELECT * INTO v_entity FROM scam_entities WHERE id = p_entity_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'entity_not_found');
  END IF;

  -- 1. Report count (0-30 pts, logarithmic)
  -- log2(report_count) * 10, capped at 30
  IF v_entity.report_count >= 1 THEN
    v_report_points := LEAST(30, FLOOR(LOG(2, GREATEST(v_entity.report_count, 1)) * 10)::INT);
  ELSE
    v_report_points := 0;
  END IF;
  v_score := v_score + v_report_points;
  v_factors := v_factors || jsonb_build_object('reportCount', jsonb_build_object(
    'points', v_report_points, 'count', v_entity.report_count
  ));

  -- 2. Verdict severity (0-20 pts)
  -- Count HIGH_RISK verdicts among linked reports
  SELECT COUNT(*) INTO v_high_risk_count
  FROM report_entity_links rel
  JOIN scam_reports sr ON sr.id = rel.report_id
  WHERE rel.entity_id = p_entity_id AND sr.verdict = 'HIGH_RISK';

  v_verdict_points := LEAST(20, v_high_risk_count * 5);
  v_score := v_score + v_verdict_points;
  v_factors := v_factors || jsonb_build_object('verdictSeverity', jsonb_build_object(
    'points', v_verdict_points, 'highRiskReports', v_high_risk_count
  ));

  -- 3. Enrichment signals (0-25 pts)
  -- Only score signals from completed checks (not failed/timed-out ones)
  v_enrichment_points := 0;

  IF v_entity.enrichment_status = 'completed'
     AND v_entity.enrichment_data IS NOT NULL
     AND v_entity.enrichment_data != '{}'::JSONB THEN

    -- ── Phone signals ──
    IF v_entity.entity_type = 'phone' THEN
      -- VoIP phone: +10 (only if phone_validation check completed)
      IF v_entity.enrichment_data->'localIntel' IS NOT NULL
         AND v_entity.enrichment_data->'localIntel'->'checksCompleted' @> '"phone_validation"'::JSONB THEN
        IF (v_entity.enrichment_data->'localIntel'->>'numberType') IN ('VOIP', 'voip') THEN
          v_enrichment_points := v_enrichment_points + 10;
          v_enrichment_signals := v_enrichment_signals || '"voip_phone"'::JSONB;
        END IF;
        -- Invalid phone number: +5
        IF (v_entity.enrichment_data->'localIntel'->>'isValid')::BOOLEAN IS DISTINCT FROM TRUE THEN
          v_enrichment_points := v_enrichment_points + 5;
          v_enrichment_signals := v_enrichment_signals || '"invalid_phone"'::JSONB;
        END IF;
      END IF;

    -- ── Email signals ──
    ELSIF v_entity.entity_type = 'email' THEN
      -- Disposable email: +8
      IF (v_entity.enrichment_data->'localIntel'->>'isDisposable')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 8;
        v_enrichment_signals := v_enrichment_signals || '"disposable_email"'::JSONB;
      END IF;
      -- No MX records (only if mx_lookup completed, not failed): +5
      IF v_entity.enrichment_data->'localIntel'->'checksCompleted' @> '"mx_lookup"'::JSONB
         AND (v_entity.enrichment_data->'localIntel'->>'hasMX')::BOOLEAN IS DISTINCT FROM TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"no_mx_records"'::JSONB;
      END IF;
      -- New domain (< 90 days): +10
      IF (v_entity.enrichment_data->'whois'->>'createdDate') IS NOT NULL THEN
        IF (NOW() - (v_entity.enrichment_data->'whois'->>'createdDate')::TIMESTAMPTZ) < INTERVAL '90 days' THEN
          v_enrichment_points := v_enrichment_points + 10;
          v_enrichment_signals := v_enrichment_signals || '"new_domain"'::JSONB;
        END IF;
      END IF;
      -- Privacy WHOIS: +5
      IF (v_entity.enrichment_data->'whois'->>'isPrivate')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"privacy_whois"'::JSONB;
      END IF;

    -- ── Domain signals ──
    ELSIF v_entity.entity_type = 'domain' THEN
      -- New domain (< 90 days): +10
      IF (v_entity.enrichment_data->'whois'->>'createdDate') IS NOT NULL THEN
        IF (NOW() - (v_entity.enrichment_data->'whois'->>'createdDate')::TIMESTAMPTZ) < INTERVAL '90 days' THEN
          v_enrichment_points := v_enrichment_points + 10;
          v_enrichment_signals := v_enrichment_signals || '"new_domain"'::JSONB;
        END IF;
      END IF;
      -- Invalid SSL: +8
      IF (v_entity.enrichment_data->'ssl'->>'valid')::BOOLEAN IS DISTINCT FROM TRUE THEN
        v_enrichment_points := v_enrichment_points + 8;
        v_enrichment_signals := v_enrichment_signals || '"invalid_ssl"'::JSONB;
      END IF;
      -- Privacy WHOIS: +5
      IF (v_entity.enrichment_data->'whois'->>'isPrivate')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"privacy_whois"'::JSONB;
      END IF;
      -- Parked domain: +5
      IF v_entity.enrichment_data->'localIntel' IS NOT NULL
         AND (v_entity.enrichment_data->'localIntel'->>'isParked')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"parked_domain"'::JSONB;
      END IF;

    -- ── URL signals ──
    ELSIF v_entity.entity_type = 'url' THEN
      -- Safe Browsing flagged malicious: +15
      IF (v_entity.enrichment_data->'safeBrowsing'->>'isMalicious')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 15;
        v_enrichment_signals := v_enrichment_signals || '"safe_browsing_flagged"'::JSONB;
      END IF;
      -- URL shortener: +5
      IF v_entity.enrichment_data->'localIntel' IS NOT NULL
         AND (v_entity.enrichment_data->'localIntel'->>'isShortened')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"url_shortener"'::JSONB;
      END IF;
      -- Open redirect: +5
      IF v_entity.enrichment_data->'localIntel' IS NOT NULL
         AND (v_entity.enrichment_data->'localIntel'->>'hasOpenRedirect')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 5;
        v_enrichment_signals := v_enrichment_signals || '"open_redirect"'::JSONB;
      END IF;

    -- ── IP signals ──
    ELSIF v_entity.entity_type = 'ip' THEN
      -- Hosting provider: +8
      IF v_entity.enrichment_data->'localIntel' IS NOT NULL
         AND (v_entity.enrichment_data->'localIntel'->>'isHostingProvider')::BOOLEAN = TRUE THEN
        v_enrichment_points := v_enrichment_points + 8;
        v_enrichment_signals := v_enrichment_signals || '"hosting_provider_ip"'::JSONB;
      END IF;
    END IF;
  END IF;

  v_enrichment_points := LEAST(25, v_enrichment_points);
  v_score := v_score + v_enrichment_points;
  v_factors := v_factors || jsonb_build_object('enrichment', jsonb_build_object(
    'points', v_enrichment_points,
    'status', v_entity.enrichment_status,
    'signals', v_enrichment_signals
  ));

  -- 4. Cluster membership (0-15 pts)
  SELECT COUNT(DISTINCT cm.cluster_id) INTO v_cluster_count
  FROM report_entity_links rel
  JOIN cluster_members cm ON cm.report_id = rel.report_id
  WHERE rel.entity_id = p_entity_id;

  v_cluster_points := LEAST(15, v_cluster_count * 8);
  v_score := v_score + v_cluster_points;
  v_factors := v_factors || jsonb_build_object('clusters', jsonb_build_object(
    'points', v_cluster_points, 'count', v_cluster_count
  ));

  -- 5. Recency (0-10 pts)
  v_days_since_last := EXTRACT(EPOCH FROM (NOW() - v_entity.last_seen)) / 86400.0;
  IF v_days_since_last <= 1 THEN
    v_recency_points := 10;
  ELSIF v_days_since_last <= 7 THEN
    v_recency_points := 7;
  ELSIF v_days_since_last <= 30 THEN
    v_recency_points := 4;
  ELSE
    v_recency_points := 0;
  END IF;
  v_score := v_score + v_recency_points;
  v_factors := v_factors || jsonb_build_object('recency', jsonb_build_object(
    'points', v_recency_points, 'daysSinceLastSeen', ROUND(v_days_since_last::NUMERIC, 1)
  ));

  -- Compute level
  v_score := LEAST(100, v_score);
  v_level := CASE
    WHEN v_score >= 75 THEN 'CRITICAL'
    WHEN v_score >= 50 THEN 'HIGH'
    WHEN v_score >= 25 THEN 'MEDIUM'
    ELSE 'LOW'
  END;

  -- Update the entity
  UPDATE scam_entities SET
    risk_score = v_score,
    risk_level = v_level,
    risk_factors = v_factors,
    risk_scored_at = NOW()
  WHERE id = p_entity_id;

  RETURN json_build_object(
    'entity_id', p_entity_id,
    'risk_score', v_score,
    'risk_level', v_level,
    'risk_factors', v_factors
  );
END;
$$;
