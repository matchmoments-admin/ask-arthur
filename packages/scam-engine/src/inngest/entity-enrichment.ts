// Entity enrichment — every 4h, finds entities with report_count >= 3 that need
// enrichment, and runs type-specific lookups combining local intelligence (DNS,
// libphonenumber) with external checks (WHOIS, SSL, Safe Browsing, geolocation).
// Tier 1 external APIs (AbuseIPDB, HIBP, crt.sh, Twilio) run inline via
// Promise.allSettled — one failure never blocks others.
// Capped at 30 entities per run to stay within serverless limits.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { lookupWhois } from "../whois";
import { checkSSL } from "../ssl";
import { checkURLReputation } from "../safebrowsing";
import { geolocateIP } from "../geolocate";
import { extractDomain } from "../url-normalize";
import {
  analyzePhone,
  analyzeEmail,
  analyzeDomain,
  analyzeIP,
  analyzeURL,
} from "../local-intel";
import { checkAbuseIPDB } from "../abuseipdb";
import { checkHIBP } from "../hibp";
import { lookupCT } from "../ct-lookup";
import { lookupPhoneNumber } from "../twilio-lookup";
import { checkIPQS } from "../ipqualityscore";

const MAX_ENTITIES_PER_RUN = 30;

interface EnrichmentResult {
  entityId: number;
  entityType: string;
  status: "completed" | "failed";
  data?: Record<string, unknown>;
  error?: string;
}

async function enrichPhone(value: string): Promise<Record<string, unknown>> {
  const checks: Promise<unknown>[] = [analyzePhone(value)];

  // Twilio Lookup v2 — only for mobile numbers (04xx/05xx in E.164: +614x/+615x).
  // Landlines and toll-free return the same data as free libphonenumber.
  // VoIP detection on mobiles is the only signal Twilio adds.
  const isMobile = /^\+61[45]/.test(value);
  const useTwilio =
    isMobile &&
    featureFlags.phoneIntelligence &&
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN;
  if (useTwilio) {
    checks.push(lookupPhoneNumber(value));
  }

  // IPQualityScore phone fraud scoring — gated by flag and env var
  const useIPQS =
    featureFlags.ipqualityScore &&
    !!process.env.IPQUALITYSCORE_API_KEY;
  if (useIPQS) {
    checks.push(checkIPQS(value));
  }

  const results = await Promise.allSettled(checks);
  const localIntel = results[0].status === "fulfilled" ? results[0].value : null;

  const data: Record<string, unknown> = { localIntel };

  let nextIdx = 1;
  if (useTwilio) {
    const r = results[nextIdx];
    if (r?.status === "fulfilled") {
      data.twilioLookup = r.value;
    }
    nextIdx++;
  }
  if (useIPQS) {
    const r = results[nextIdx];
    if (r?.status === "fulfilled") {
      data.ipqs = r.value;
    }
  }

  return data;
}

async function enrichDomain(value: string): Promise<Record<string, unknown>> {
  const checks: Promise<unknown>[] = [
    analyzeDomain(value),
    lookupWhois(value),
    checkSSL(value),
  ];

  // Certificate Transparency — gated by ctLookup flag
  const useCT = featureFlags.ctLookup;
  if (useCT) {
    checks.push(lookupCT(value));
  }

  const results = await Promise.allSettled(checks);
  const localIntel = results[0].status === "fulfilled" ? results[0].value : null;
  const whois = results[1].status === "fulfilled" ? results[1].value as Record<string, unknown> : null;
  const ssl = results[2].status === "fulfilled" ? results[2].value as Record<string, unknown> : null;

  const data: Record<string, unknown> = {
    localIntel,
    whois: whois ? {
      registrar: (whois as { registrar?: string }).registrar,
      registrantCountry: (whois as { registrantCountry?: string }).registrantCountry,
      createdDate: (whois as { createdDate?: string }).createdDate,
      expiresDate: (whois as { expiresDate?: string }).expiresDate,
      nameServers: (whois as { nameServers?: string[] }).nameServers,
      isPrivate: (whois as { isPrivate?: boolean }).isPrivate,
    } : null,
    ssl: ssl ? {
      valid: (ssl as { valid?: boolean }).valid,
      issuer: (ssl as { issuer?: string }).issuer,
      daysRemaining: (ssl as { daysRemaining?: number }).daysRemaining,
    } : null,
  };

  if (useCT && results[3]?.status === "fulfilled") {
    data.ctLookup = results[3].value;
  }

  return data;
}

async function enrichURL(value: string): Promise<Record<string, unknown>> {
  const [localIntel, reputation] = await Promise.all([
    analyzeURL(value),
    checkURLReputation([value]),
  ]);

  const result = reputation[0];

  // Chain: analyze the final destination domain if it differs from the original
  let finalDomainIntel: Awaited<ReturnType<typeof analyzeDomain>> | null = null;
  if (localIntel.finalUrl && localIntel.finalUrl !== value) {
    const finalDomain = extractDomain(localIntel.finalUrl);
    const originalDomain = extractDomain(value);
    if (finalDomain && finalDomain !== originalDomain) {
      try {
        finalDomainIntel = await analyzeDomain(finalDomain);
      } catch (err) {
        logger.warn("Failed to analyze final destination domain", {
          domain: finalDomain,
          error: String(err),
        });
      }
    }
  }

  return {
    localIntel,
    ...(finalDomainIntel && { finalDomainIntel }),
    safeBrowsing: {
      isMalicious: result?.isMalicious ?? false,
      sources: result?.sources ?? [],
    },
  };
}

async function enrichIP(value: string): Promise<Record<string, unknown>> {
  const checks: Promise<unknown>[] = [
    analyzeIP(value),
    geolocateIP(value),
  ];

  // AbuseIPDB — gated by abuseIPDB flag and env var
  const useAbuseIPDB = featureFlags.abuseIPDB && !!process.env.ABUSEIPDB_API_KEY;
  if (useAbuseIPDB) {
    checks.push(checkAbuseIPDB(value));
  }

  const results = await Promise.allSettled(checks);
  const localIntel = results[0].status === "fulfilled" ? results[0].value : null;
  const geo = results[1].status === "fulfilled" ? results[1].value as { region?: string; countryCode?: string } : null;

  const data: Record<string, unknown> = {
    localIntel,
    geo: {
      region: geo?.region ?? null,
      countryCode: geo?.countryCode ?? null,
    },
  };

  if (useAbuseIPDB && results[2]?.status === "fulfilled") {
    data.abuseIPDB = results[2].value;
  }

  return data;
}

async function enrichEmail(value: string): Promise<Record<string, unknown>> {
  const domain = value.split("@")[1];
  if (!domain) return { localIntel: null, source: "no_domain" };

  const checks: Promise<unknown>[] = [
    analyzeEmail(value),
    (async () => {
      const [whois, ssl] = await Promise.all([
        lookupWhois(domain),
        checkSSL(domain),
      ]);
      return {
        whois: {
          registrar: whois.registrar,
          registrantCountry: whois.registrantCountry,
          createdDate: whois.createdDate,
          expiresDate: whois.expiresDate,
          nameServers: whois.nameServers,
          isPrivate: whois.isPrivate,
        },
        ssl: {
          valid: ssl.valid,
          issuer: ssl.issuer,
          daysRemaining: ssl.daysRemaining,
        },
      };
    })(),
  ];

  // HIBP breach check — gated by hibpCheck flag and env var
  const useHIBP = featureFlags.hibpCheck && !!process.env.HIBP_API_KEY;
  if (useHIBP) {
    checks.push(checkHIBP(value));
  }

  const results = await Promise.allSettled(checks);
  const localIntel = results[0].status === "fulfilled" ? results[0].value : null;
  const domainEnrichment = results[1].status === "fulfilled"
    ? results[1].value as Record<string, unknown>
    : {};

  const data: Record<string, unknown> = {
    localIntel,
    ...domainEnrichment,
  };

  if (useHIBP && results[2]?.status === "fulfilled") {
    data.hibp = results[2].value;
  }

  return data;
}

export const entityEnrichmentFanOut = inngest.createFunction(
  {
    id: "pipeline-entity-enrichment",
    name: "Pipeline: Enrich Pending Entities",
    concurrency: { limit: 1 },
    // Each fan-out run triggers up to 30 × (Twilio Lookup + AbuseIPDB + IPQS +
    // HIBP + WHOIS + SSL + crt.sh) — Twilio Lookup is the most expensive at
    // ~A$0.005/call. A manual re-trigger storm could burn through the
    // AbuseIPDB free-tier 1k/day cap in two clicks. Cron-safe (10m < 4h).
    rateLimit: { limit: 1, period: "10m" },
  },
  { cron: "0 */4 * * *" }, // Every 4 hours
  async ({ step }) => {
    if (!featureFlags.entityEnrichment) {
      return { skipped: true, reason: "entityEnrichment feature flag disabled" };
    }

    // Step 1: Find entities needing enrichment
    const pendingEntities = await step.run(
      "fetch-pending-entities",
      async () => {
        const supabase = createServiceClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("scam_entities")
          .select("id, entity_type, normalized_value")
          .in("enrichment_status", ["pending", "failed"])
          .gte("report_count", 3)
          .order("report_count", { ascending: false })
          .limit(MAX_ENTITIES_PER_RUN);

        if (error) {
          logger.error("Failed to fetch pending entities", {
            error: String(error),
          });
          throw new Error(error.message);
        }

        return (data || []).map((row) => ({
          id: row.id,
          type: row.entity_type as string,
          value: row.normalized_value as string,
        }));
      }
    );

    if (pendingEntities.length === 0) {
      return { enriched: 0, reason: "no pending entities" };
    }

    // Step 2: Mark as in_progress
    await step.run("mark-in-progress", async () => {
      const supabase = createServiceClient();
      if (!supabase) return;

      const ids = pendingEntities.map((e) => e.id);
      await supabase
        .from("scam_entities")
        .update({ enrichment_status: "in_progress" })
        .in("id", ids);
    });

    // Step 3: Enrich each entity with type-specific logic
    const results: EnrichmentResult[] = await Promise.all(
      pendingEntities.map((entity) =>
        step.run(`enrich-entity-${entity.id}`, async () => {
          const supabase = createServiceClient();
          if (!supabase)
            return {
              entityId: entity.id,
              entityType: entity.type,
              status: "failed" as const,
              error: "No Supabase client",
            };

          try {
            let enrichmentData: Record<string, unknown>;

            switch (entity.type) {
              case "phone":
                enrichmentData = await enrichPhone(entity.value);
                break;
              case "domain":
                enrichmentData = await enrichDomain(entity.value);
                break;
              case "url":
                enrichmentData = await enrichURL(entity.value);
                break;
              case "ip":
                enrichmentData = await enrichIP(entity.value);
                break;
              case "email":
                enrichmentData = await enrichEmail(entity.value);
                break;
              default:
                enrichmentData = { source: "unsupported_type" };
            }

            await supabase
              .from("scam_entities")
              .update({
                enrichment_status: "completed",
                enrichment_data: enrichmentData,
                enriched_at: new Date().toISOString(),
                enrichment_error: null,
              })
              .eq("id", entity.id);

            return {
              entityId: entity.id,
              entityType: entity.type,
              status: "completed" as const,
              data: enrichmentData,
            };
          } catch (err) {
            const errorMsg = String(err);
            await supabase
              .from("scam_entities")
              .update({
                enrichment_status: "failed",
                enrichment_error: errorMsg.slice(0, 500),
              })
              .eq("id", entity.id);

            return {
              entityId: entity.id,
              entityType: entity.type,
              status: "failed" as const,
              error: errorMsg,
            };
          }
        })
      )
    );

    const completed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;

    logger.info("Entity enrichment complete", {
      total: pendingEntities.length,
      completed,
      failed,
    });

    return { total: pendingEntities.length, completed, failed, results };
  }
);
