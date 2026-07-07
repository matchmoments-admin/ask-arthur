import { waitUntil } from "@vercel/functions";

import { getLogger } from "@askarthur/utils/axiom-logger";

import { logCost } from "@/lib/cost-telemetry";

/**
 * Observability sink for the enforcement / reported-takedown flow.
 *
 * The user requirement: be conscious of what's happening with REPORTED TAKEDOWNS,
 * with telemetry + Axiom, without blowing the Axiom free tier (400 GB/mo).
 *
 * How this satisfies both:
 *  - Durable, timestamped audit trail → a `cost_telemetry` row per event
 *    (reuses existing infra: /admin/costs dashboard + weekly Telegram digest +
 *    SQL-queryable; NO new table). This is the source of truth for "what did we
 *    report and what happened", queryable per channel/outcome/time.
 *  - Ops/alerting trail → an ALWAYS-SHIP Axiom event (`.warn`, which bypasses
 *    the 10% INFO sampling). These events are RARE by nature — a domain
 *    weaponises, is reported, or is actioned/declined/re-emerges only
 *    occasionally — so always-shipping them costs a trivial slice of the budget
 *    while guaranteeing no takedown record is sampled away. Axiom stays gated by
 *    FF_AXIOM_ENABLED (a no-op until on), so this is free until observability is
 *    switched on.
 *
 * High-VOLUME paths (NRD ingest, per-domain re-checks) deliberately do NOT call
 * this — they stay on the sampled fn-lifecycle signals from withAxiomLogging.
 * Only the low-volume, high-value enforcement transitions land here.
 *
 * Fire-and-forget; never throws (observability must never break enforcement).
 */

export type EnforcementEvent =
  | "cases_opened" // enforcement plan opened cases for a weaponised lookalike
  | "reported" // submitted to a takedown channel (outbound)
  | "actioned" // a channel confirmed the takedown
  | "declined" // a channel declined (e.g. Netcraft "no threats")
  | "re_emerged" // a taken-down domain resolved again
  | "rejected"; // a report was rejected

export interface EnforcementEventFields {
  alertId: number;
  domain: string;
  /** netcraft / apwg / openphish / safe_browsing / registrar_abuse / … or "plan". */
  channel: string;
  caseId?: number;
  brand?: string | null;
  autonomy?: string;
  /** Raw provider state (e.g. Netcraft "no threats" / "malicious"). */
  outcome?: string;
  /** Inngest runId for cross-signal correlation. */
  runId?: string;
  /** Extra structured context (channel list, counts, etc.). */
  extra?: Record<string, unknown>;
}

export function logEnforcementEvent(
  event: EnforcementEvent,
  fields: EnforcementEventFields,
): void {
  const { extra, ...core } = fields;
  try {
    // 1. Durable audit trail (reuses cost_telemetry — timestamped, per-channel).
    logCost({
      feature: "clone_enforcement",
      provider: fields.channel,
      operation: `enforcement.${event}`,
      units: 1,
      unitCostUsd: 0,
      requestId: fields.runId ?? null,
      metadata: { event, ...core, ...(extra ?? {}) },
    });

    // 2. Always-ship Axiom event (rare + audit-critical → never sampled away).
    const log = getLogger({
      source: "inngest",
      requestId: fields.runId,
      feature: "clone_enforcement",
    });
    log.warn(`enforcement.${event}`, { event, ...core, ...(extra ?? {}) });
    waitUntil(log.flush());
  } catch {
    // Observability must never break the enforcement path.
  }
}
