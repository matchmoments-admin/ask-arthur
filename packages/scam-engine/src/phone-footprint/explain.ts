// Claude-generated plain-English explanation for a Footprint report.
//
// Runs only for basic/full tiers — teaser returns a templated two-liner
// since it has no provider detail worth narrating and the goal is to
// upsell into paid. Reuses the existing @anthropic-ai/sdk setup and the
// same Haiku 4.5 model the core analyze pipeline uses, so there's a
// single vendor bill and a single upstream to monitor.
//
// Cost: ~$0.002/call at 400 in / 200 out tokens. Prompt-cached — the
// system prompt is static and will hit cache from the second call
// onwards, dropping input cost to ~$0.0002 for subsequent runs.
//
// Error behaviour: any upstream failure returns a short templated string
// and logs a warn. Never throws — explanation is an enhancement, not a
// correctness requirement, so failures must not cascade to the orchestrator.

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@askarthur/utils/logger";
import type { Footprint, PillarId, PillarResult } from "./types";

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 8_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// Static system prompt — prompt-cached so repeat calls stay cheap. Keeps
// the LLM scoped to plain explanation; no advice, no speculation about
// the individual behind the number. This is also the APP 3.5 / APP 1.7
// hard line — the output must describe aggregate signals, not accuse.
const SYSTEM_PROMPT = `You are an assistant writing plain-English explanations for an Australian phone-number footprint report.

Input: a JSON object describing per-pillar signals for a phone number.
Output: one paragraph, 70-120 words, explaining what the numbers mean in
everyday language. Write for an Australian consumer; use "your number" /
"this number" based on the ownershipProven flag.

Rules:
- Stick to the facts in the input. Never speculate about the owner.
- If multiple pillars are unavailable, say so honestly ("We couldn't reach
  the fraud-score provider, so this report is based on …").
- Never label the owner — only describe the signals.
- No recommendations, no "you should call your bank", no legal advice.
- Plain English, no jargon. British-AU spelling ("colour", "behaviour").
- Do not use bullet points or headings — single flowing paragraph.`;

export async function explainFootprint(
  footprint: Footprint,
  opts: { ownershipProven: boolean } = { ownershipProven: false },
): Promise<string | null> {
  // Teaser tier gets a templated line — cheap, consistent, no Claude call.
  if (footprint.tier === "teaser") {
    return templatedTeaserExplanation(footprint);
  }

  const client = getClient();
  if (!client) {
    logger.warn("explainFootprint: ANTHROPIC_API_KEY not set, using template");
    return templatedBasicExplanation(footprint, opts.ownershipProven);
  }

  // Compact the pillar data for the prompt — strip verbose raw fields
  // (carrier strings, raw breach names) that don't help the model phrase
  // anything. The model sees shape + severity, not PII.
  const summary = compactSummary(footprint, opts.ownershipProven);

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 220,
        system: [
          {
            type: "text" as const,
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        messages: [
          {
            role: "user",
            content: `\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``,
          },
        ],
      },
      { timeout: TIMEOUT_MS },
    );

    const text =
      response.content[0]?.type === "text"
        ? response.content[0].text.trim()
        : "";

    if (!text) {
      return templatedBasicExplanation(footprint, opts.ownershipProven);
    }
    return text;
  } catch (err) {
    logger.warn("explainFootprint: claude call failed", { error: String(err) });
    return templatedBasicExplanation(footprint, opts.ownershipProven);
  }
}

// ---------------------------------------------------------------------------
// Compaction + templated fallbacks
// ---------------------------------------------------------------------------

interface PillarSummary {
  pillar: PillarId;
  available: boolean;
  score: number;
  triggered: boolean;
  detailCount?: number;
  reason?: string;
}

function compactSummary(fp: Footprint, ownershipProven: boolean) {
  const pillars: PillarSummary[] = (
    Object.keys(fp.pillars) as PillarId[]
  ).map((id) => pillarSummary(id, fp.pillars[id]));
  return {
    msisdn_suffix: fp.msisdn_e164.slice(-4),
    ownershipProven,
    composite_score: fp.composite_score,
    band: fp.band,
    coverage: fp.coverage,
    pillars,
  };
}

function pillarSummary(id: PillarId, p: PillarResult): PillarSummary {
  return {
    pillar: id,
    available: p.available,
    score: p.score,
    triggered: p.available && p.score > 0,
    detailCount: detailCount(id, p),
    reason: p.reason,
  };
}

// Produce a single "count" number per pillar that summarises the signal
// without exposing raw provider output. The model reads this to phrase
// its paragraph without ever seeing, e.g., a specific breach name.
function detailCount(id: PillarId, p: PillarResult): number | undefined {
  if (!p.available || !p.detail) return undefined;
  switch (id) {
    case "scam_reports":
      return (p.detail.total_reports as number) ?? undefined;
    case "breach":
      return (p.detail.breach_count as number) ?? undefined;
    case "sim_swap":
      return p.detail.sim_swapped || p.detail.device_swapped ? 1 : 0;
    case "reputation":
      return (p.detail.fraud_score as number) ?? undefined;
    case "identity":
      return p.detail.isVoip || p.detail.valid === false ? 1 : 0;
  }
}

function templatedTeaserExplanation(fp: Footprint): string {
  if (fp.band === "safe") {
    return "This is a summary view — we didn't find strong signals against this number, but to see the full breakdown (breach exposure, carrier identity, recent SIM swap, live fraud score) you'll need to verify ownership of the number first.";
  }
  if (fp.band === "critical" || fp.band === "high") {
    return "This is a summary view — several risk signals appear against this number. For the full breakdown, including which data breaches, scam reports, or carrier changes triggered this result, verify ownership of the number.";
  }
  return "This is a summary view — some signals appear against this number. Verify ownership to see the detailed per-source breakdown.";
}

function templatedBasicExplanation(
  fp: Footprint,
  ownershipProven: boolean,
): string {
  const subject = ownershipProven ? "Your number" : "This number";
  const availableCount = (Object.values(fp.pillars) as PillarResult[]).filter(
    (p) => p.available,
  ).length;
  const coverageNote =
    availableCount < 5
      ? ` We couldn't reach ${5 - availableCount} data source${5 - availableCount === 1 ? "" : "s"} for this check.`
      : "";
  if (fp.band === "safe") {
    return `${subject} scored ${fp.composite_score}/100 across the data sources we could reach — no strong risk signals appeared.${coverageNote}`;
  }
  if (fp.band === "caution") {
    return `${subject} scored ${fp.composite_score}/100 — a mix of signals worth noting but nothing critical.${coverageNote} Review the signal breakdown below for specifics.`;
  }
  if (fp.band === "high") {
    return `${subject} scored ${fp.composite_score}/100 — multiple risk indicators fired, including reports or breach exposure.${coverageNote} The signal breakdown shows which pillars contributed.`;
  }
  return `${subject} scored ${fp.composite_score}/100 — this is a critical band with serious risk signals across several data sources.${coverageNote} Review each pillar for detail.`;
}
