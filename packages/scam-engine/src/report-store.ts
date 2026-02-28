// Intelligence Core: store unified scam reports + entity linkage.
// All writes are fire-and-forget — errors are logged, never thrown.

import { createServiceClient } from "@askarthur/supabase/server";
import type {
  AnalysisResult,
  EntityType,
  ExtractionMethod,
  EntityRole,
  ReportSource,
  InputMode,
} from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";
import { scrubPII } from "./pipeline";
import { normalizePhoneE164, normalizeEmail } from "./phone-normalize";
import { normalizeURL, extractDomain } from "./url-normalize";

/** Entity to be upserted + linked to a report */
export interface EntityToLink {
  entityType: EntityType;
  normalizedValue: string;
  rawValue?: string;
  extractionMethod: ExtractionMethod;
  role: EntityRole;
}

export interface StoreScamReportParams {
  reporterHash: string;
  source: ReportSource;
  inputMode: InputMode | null;
  analysis: AnalysisResult;
  text?: string;
  region: string | null;
  countryCode: string | null;
  verifiedScamId?: number | null;
  entities: EntityToLink[];
}

/**
 * Store a unified scam report + link extracted entities.
 * Fire-and-forget: logs errors but never throws.
 */
export async function storeScamReport(
  params: StoreScamReportParams
): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return null;

    const scrubbedContent = params.text ? scrubPII(params.text) : null;
    const scrubbedResult = {
      summary: scrubPII(params.analysis.summary),
      redFlags: params.analysis.redFlags.map(scrubPII),
      nextSteps: params.analysis.nextSteps,
      scamType: params.analysis.scamType,
      channel: params.analysis.channel,
      impersonatedBrand: params.analysis.impersonatedBrand,
    };

    // 1. Create report row
    const { data: reportData, error: reportError } = await supabase.rpc(
      "create_scam_report",
      {
        p_reporter_hash: params.reporterHash,
        p_source: params.source,
        p_input_mode: params.inputMode,
        p_verdict: params.analysis.verdict,
        p_confidence_score: params.analysis.confidence,
        p_scam_type: params.analysis.scamType ?? null,
        p_channel: params.analysis.channel ?? null,
        p_delivery_method: null,
        p_impersonated_brand: params.analysis.impersonatedBrand ?? null,
        p_scrubbed_content: scrubbedContent,
        p_analysis_result: scrubbedResult,
        p_verified_scam_id: params.verifiedScamId ?? null,
        p_region: params.region,
        p_country_code: params.countryCode,
      }
    );

    if (reportError) {
      logger.error("create_scam_report RPC failed", {
        error: reportError.message,
        code: reportError.code,
      });
      return null;
    }

    const reportId = reportData as number;

    // 2. Upsert entities + link to report
    for (const entity of params.entities) {
      try {
        const { data: entityData, error: entityError } = await supabase.rpc(
          "upsert_scam_entity",
          {
            p_entity_type: entity.entityType,
            p_normalized_value: entity.normalizedValue,
            p_raw_value: entity.rawValue ?? null,
          }
        );

        if (entityError) {
          logger.error("upsert_scam_entity RPC failed", {
            error: entityError.message,
            entityType: entity.entityType,
          });
          continue;
        }

        const { entity_id: entityId } = entityData as {
          entity_id: number;
          is_new: boolean;
        };

        const { error: linkError } = await supabase.rpc(
          "link_report_entity",
          {
            p_report_id: reportId,
            p_entity_id: entityId,
            p_extraction_method: entity.extractionMethod,
            p_role: entity.role,
          }
        );

        if (linkError) {
          logger.error("link_report_entity RPC failed", {
            error: linkError.message,
            reportId,
            entityId,
          });
        }
      } catch (err) {
        logger.error("Entity upsert/link failed", {
          error: String(err),
          entityType: entity.entityType,
        });
      }
    }

    return reportId;
  } catch (err) {
    logger.error("storeScamReport failed", { error: String(err) });
    return null;
  }
}

/**
 * Build a list of entities to link from extracted contacts and URLs.
 * Reuses existing normalization functions.
 */
export function buildEntities(params: {
  phones?: Array<{ value: string; context: string }>;
  emails?: Array<{ value: string; context: string }>;
  urls?: Array<{ url: string; isMalicious: boolean; sources: string[] }>;
  extractionMethod: ExtractionMethod;
}): EntityToLink[] {
  const entities: EntityToLink[] = [];

  // Phone numbers → E.164 normalized
  if (params.phones) {
    for (const phone of params.phones) {
      const e164 = normalizePhoneE164(phone.value);
      if (e164) {
        entities.push({
          entityType: "phone",
          normalizedValue: e164,
          rawValue: undefined, // PII — don't store raw
          extractionMethod: params.extractionMethod,
          role: "sender",
        });
      }
    }
  }

  // Email addresses → lowercased
  if (params.emails) {
    for (const email of params.emails) {
      const normalized = normalizeEmail(email.value);
      entities.push({
        entityType: "email",
        normalizedValue: normalized,
        rawValue: undefined, // PII — don't store raw
        extractionMethod: params.extractionMethod,
        role: "sender",
      });
    }
  }

  // URLs → normalized URL + extracted domain
  if (params.urls) {
    const seenDomains = new Set<string>();
    for (const urlResult of params.urls) {
      const normalized = normalizeURL(urlResult.url);
      if (normalized) {
        entities.push({
          entityType: "url",
          normalizedValue: normalized.normalized,
          rawValue: urlResult.url,
          extractionMethod: params.extractionMethod,
          role: "mentioned",
        });

        // Also extract domain as a separate entity (dedup)
        if (normalized.domain && !seenDomains.has(normalized.domain)) {
          seenDomains.add(normalized.domain);
          entities.push({
            entityType: "domain",
            normalizedValue: normalized.domain,
            rawValue: undefined,
            extractionMethod: params.extractionMethod,
            role: "mentioned",
          });
        }
      } else {
        // Fallback: extract domain even if URL normalization fails
        const domain = extractDomain(urlResult.url);
        if (domain && !seenDomains.has(domain)) {
          seenDomains.add(domain);
          entities.push({
            entityType: "domain",
            normalizedValue: domain,
            rawValue: undefined,
            extractionMethod: params.extractionMethod,
            role: "mentioned",
          });
        }
      }
    }
  }

  return entities;
}
