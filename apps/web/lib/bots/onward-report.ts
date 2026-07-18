import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { AnalysisResult } from "@askarthur/types";
import { getBotRedis } from "./redis";
import { submitOnwardReports, type SelectedDestination } from "@/lib/onward/submit";
import {
  buildEvidenceBlock,
  getDeepLink,
  type OnwardDestinationEnum,
  type EvidenceContext,
} from "@/lib/onward/destinations";

// The bot "Report scam" flow, wired into the real onward-reporting routing
// brain (get_onward_destinations → submitOnwardReports → onward_report_log +
// per-destination Inngest workers) instead of the old static Scamwatch text.
//
// A chat button carries no reference to the message it followed, so at analysis
// time each handler stashes a compact evidence snapshot keyed by the user; the
// later "Report scam" tap retrieves it and drives the pipeline. Reply text is
// plain (no markup) so it renders identically on WhatsApp / Messenger /
// Telegram / Slack — the single source of the report action across platforms.

export type BotPlatform = "whatsapp" | "messenger" | "telegram" | "slack";

/** Compact snapshot stashed at analysis time; enough to resolve destinations
 *  and build a paste-ready evidence block without re-reading the scrubbed row. */
export interface BotReportStash {
  scamReportId: number;
  scamType: string | null;
  impersonatedBrand: string | null;
  scammerUrls: string[];
  scammerPhones: string[];
  scammerEmails: string[];
  redFlags: string[];
}

const STASH_TTL_SECONDS = 60 * 60; // 1h — matches a realistic "tap report" gap

async function hashUser(userId: string): Promise<string> {
  const data = new TextEncoder().encode(userId);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function stashKey(platform: BotPlatform, userHash: string): string {
  return `bot:lastreport:${platform}:${userHash}`;
}

/** Build the stash from a fresh analysis result + the persisted report id. */
export function buildReportStash(
  scamReportId: number,
  result: AnalysisResult,
): BotReportStash {
  return {
    scamReportId,
    scamType: result.scamType ?? null,
    impersonatedBrand: result.impersonatedBrand ?? null,
    scammerUrls: [],
    scammerPhones: (result.scammerContacts?.phoneNumbers ?? []).map((c) => c.value),
    scammerEmails: (result.scammerContacts?.emailAddresses ?? []).map((c) => c.value),
    redFlags: result.redFlags ?? [],
  };
}

/**
 * Stash the report context for a user so a later "Report scam" tap can drive
 * the onward pipeline. No-op when Redis or the report id is unavailable (the
 * tap then falls back to static guidance). Never throws.
 */
export async function stashBotReport(
  platform: BotPlatform,
  userId: string,
  stash: BotReportStash | null,
): Promise<void> {
  if (!stash || stash.scamReportId <= 0) return;
  const redis = getBotRedis();
  if (!redis) return;
  try {
    const key = stashKey(platform, await hashUser(userId));
    await redis.set(key, JSON.stringify(stash), { ex: STASH_TTL_SECONDS });
  } catch (err) {
    logger.warn("bot onward: stash failed", { platform, error: String(err) });
  }
}

export interface ResolvedDestination {
  destination: OnwardDestinationEnum;
  destination_key: string;
  display_name: string;
  contact_type: string;
}

/**
 * Handle a "Report scam" tap: resolve destinations for the stashed report,
 * submit them through the shared onward pipeline, and return a plain-text reply
 * (deep-links for user-action destinations + confirmation of what we submitted
 * + a paste-ready evidence block). Returns null when there is nothing stashed
 * (expired / attribution off) so the caller can fall back to static guidance.
 */
export async function reportBotScam(
  platform: BotPlatform,
  userId: string,
): Promise<string | null> {
  const redis = getBotRedis();
  if (!redis) return null;

  let stash: BotReportStash | null = null;
  try {
    const key = stashKey(platform, await hashUser(userId));
    const raw = await redis.get<string | BotReportStash>(key);
    stash =
      typeof raw === "string" ? (JSON.parse(raw) as BotReportStash) : (raw ?? null);
  } catch (err) {
    logger.warn("bot onward: stash read failed", { platform, error: String(err) });
    return null;
  }
  if (!stash || !stash.scamReportId) return null;

  const supabase = createServiceClient();
  if (!supabase) return null;

  // Resolve destinations via the same RPC the web picker uses. Bots can't run
  // the loss/PII micro-question, so both default false (conservative: yields
  // Scamwatch + threat feed always, brand security team when a known brand is
  // impersonated). channel is null — a forwarded message isn't a live email we
  // can relay to ACMA.
  const { data, error } = await supabase.rpc("get_onward_destinations", {
    p_scam_type: stash.scamType,
    p_impersonated_brand: stash.impersonatedBrand,
    p_channel: null,
    p_has_financial_loss: false,
    p_has_pii_compromise: false,
  });
  if (error) {
    logger.error("bot onward: get_onward_destinations failed", {
      platform,
      error: String(error),
    });
    return null;
  }

  const dests = (data ?? []) as ResolvedDestination[];
  if (dests.length === 0) return null;

  const selected: SelectedDestination[] = dests.map((d) => ({
    destination: d.destination,
    destination_key: d.destination_key,
  }));

  const outcome = await submitOnwardReports(supabase, {
    scamReportId: stash.scamReportId,
    selected,
  });
  const submitted = outcome.ok;

  return buildReportReply(dests, stash, submitted);
}

/** Compose the cross-platform plain-text report reply. Exported for tests. */
export function buildReportReply(
  dests: ResolvedDestination[],
  stash: BotReportStash,
  submitted: boolean,
): string {
  const linkLines: string[] = [];
  const submittedLines: string[] = [];
  let feedAdded = false;

  for (const d of dests) {
    const deepLink = getDeepLink(d.destination);
    if (deepLink) {
      linkLines.push(`• ${d.display_name}: ${deepLink}`);
    } else if (d.destination === "ask_arthur_feed") {
      feedAdded = true;
    } else if (d.contact_type === "email") {
      submittedLines.push(`• ${d.display_name}`);
    }
  }

  const evidence: EvidenceContext = {
    reportRef: `AA-${stash.scamReportId}`,
    scamType: stash.scamType,
    impersonatedBrand: stash.impersonatedBrand,
    channel: null,
    scammerUrls: stash.scammerUrls,
    scammerPhones: stash.scammerPhones,
    scammerEmails: stash.scammerEmails,
    redFlags: stash.redFlags.slice(0, 5),
    receivedAt: new Date().toLocaleDateString("en-AU"),
  };

  const parts: string[] = [];
  parts.push(
    submitted && feedAdded
      ? "✅ Logged. I've added this to the Ask Arthur threat feed to warn other Australians."
      : "✅ Here's how to report this scam:",
  );
  if (submitted && submittedLines.length > 0) {
    parts.push("", "Reported on your behalf:", ...submittedLines);
  }
  if (linkLines.length > 0) {
    parts.push(
      "",
      "To finish the official report, open these and paste the details below:",
      ...linkLines,
    );
  }
  parts.push(
    "",
    "If you've lost money or shared ID, also call your bank and report to ReportCyber (cyber.gov.au/report).",
    "",
    "--- Copy-paste evidence ---",
    buildEvidenceBlock(evidence),
  );
  return parts.join("\n");
}
