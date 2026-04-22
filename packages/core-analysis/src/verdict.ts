import type { Verdict } from "@askarthur/types";

// Single source of truth for how per-source signals combine into a final
// verdict. All four surfaces (web analyze, extension analyze, bot analyze,
// media / analyze-ad) call this function. Adding a new signal type should
// require updating exactly one switch or conditional here — the `never`
// exhaustiveness check in `verdictRank` ensures a compile error if the
// Verdict union itself is extended without updating callers.
//
// Pure: no I/O, no mutation, no dependency on request context. Safe to
// property-test with fast-check.

export interface AiSignal {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
}

export interface UrlReputationSignal {
  url: string;
  isMalicious: boolean;
  /** Upstream sources that reported the URL (e.g. "google-safebrowsing", "virustotal") */
  sources: string[];
}

export interface RedirectChainSignal {
  originalUrl: string;
  finalUrl: string;
  hopCount: number;
  isShortened: boolean;
  hasOpenRedirect: boolean;
  truncated: boolean;
}

export interface InjectionSignal {
  detected: boolean;
  patterns: string[];
}

/**
 * Deepfake detection signal. Providers split into two camps:
 * - **Boolean providers** (Hive `isDeepfake`): caller passes `{ detected: true, provider: "hive" }`.
 * - **Score providers** (Reality Defender, Resemble AI): caller passes `{ score: 0.92, provider: "reality-defender" }`.
 *
 * At least one of `detected` or `score` must be meaningful, else the signal
 * is a no-op. `isAiGenerated` is a separate sub-signal: AI-generated imagery
 * is a red flag but does not by itself escalate the verdict (a legitimate
 * artist may post AI images).
 */
export interface DeepfakeSignal {
  /** Provider asserted this is a deepfake (boolean providers). */
  detected?: boolean;
  /** 0-1, higher = more likely to be a deepfake (score providers). */
  score?: number;
  /** e.g. "hive", "reality-defender", "resemble" */
  provider: string;
  /** Image is AI-generated (not necessarily deepfake). Red flag only, no escalation. */
  isAiGenerated?: boolean;
}

export interface VerdictSignals {
  ai: AiSignal;
  urlResults?: UrlReputationSignal[];
  redirectChains?: RedirectChainSignal[];
  injection?: InjectionSignal;
  deepfake?: DeepfakeSignal;
}

export interface VerdictMergeInput extends VerdictSignals {}

export interface VerdictMergeOutput {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  /** Observability: why the final verdict differs from the raw AI verdict. */
  signals: {
    aiVerdict: Verdict;
    maliciousUrlCount: number;
    injectionDetected: boolean;
    deepfakeDetected: boolean;
  };
}

/**
 * Deepfake score at which we consider a signal "detected" at all.
 * Below this, the signal is noise — most providers return non-zero scores
 * on benign images.
 */
const DEEPFAKE_DETECTION_THRESHOLD = 0.5;

/**
 * Deepfake score at which we escalate to HIGH_RISK regardless of other signals.
 */
const DEEPFAKE_HIGH_RISK_THRESHOLD = 0.85;

const NO_LINKS_WARNING = "Do not click any links in this message.";

/**
 * Ordinal rank of a verdict. `never` on default makes the Verdict union
 * exhaustiveness-checked: extending Verdict without updating this function is
 * a compile error.
 */
export function verdictRank(v: Verdict): number {
  switch (v) {
    case "SAFE":
      return 0;
    case "UNCERTAIN":
      return 1;
    case "SUSPICIOUS":
      return 2;
    case "HIGH_RISK":
      return 3;
    default: {
      const _exhaustive: never = v;
      return _exhaustive;
    }
  }
}

/** Return the higher-severity of two verdicts (never downgrades). */
function escalate(a: Verdict, b: Verdict): Verdict {
  return verdictRank(a) >= verdictRank(b) ? a : b;
}

/**
 * Combine the AI verdict with URL reputation, redirect analysis, injection
 * detection, and deepfake signals into a final verdict. Pure function —
 * always returns a new object; never throws.
 */
export function mergeVerdict(signals: VerdictSignals): VerdictMergeOutput {
  const aiVerdict = signals.ai.verdict;
  let verdict: Verdict = aiVerdict;
  const redFlags = [...signals.ai.redFlags];
  const nextSteps = [...signals.ai.nextSteps];

  // URL threats — escalate to HIGH_RISK when any URL is flagged malicious.
  const maliciousUrls = (signals.urlResults ?? []).filter((r) => r.isMalicious);
  if (maliciousUrls.length > 0) {
    verdict = escalate(verdict, "HIGH_RISK");
    for (const mal of maliciousUrls) {
      const sources = mal.sources.length > 0 ? mal.sources.join(" and ") : "threat feeds";
      redFlags.push(`URL flagged by ${sources}: ${mal.url}`);
    }
    if (!nextSteps.includes(NO_LINKS_WARNING)) {
      nextSteps.unshift(NO_LINKS_WARNING);
    }
  }

  // Redirect chain red flags — informational only, do NOT escalate verdict.
  // The original URL will already have been scanned above; this exposes
  // obfuscation patterns to the user.
  for (const chain of signals.redirectChains ?? []) {
    if (chain.isShortened) {
      redFlags.push(
        `Shortened URL detected: ${chain.originalUrl} redirects to ${chain.finalUrl}`
      );
    }
    if (chain.hasOpenRedirect) {
      redFlags.push(`Open redirect detected in chain from ${chain.originalUrl}`);
    }
    if (chain.truncated) {
      redFlags.push(
        `Excessive redirect chain (${chain.hopCount}+ hops) from ${chain.originalUrl}`
      );
    }
  }

  // Prompt injection → floor at SUSPICIOUS. Never downgrade, so an AI that
  // already returned HIGH_RISK stays HIGH_RISK even if injection fires.
  const injectionDetected = !!signals.injection?.detected;
  if (injectionDetected) {
    verdict = escalate(verdict, "SUSPICIOUS");
    redFlags.push(
      "This message contains manipulation patterns that attempt to influence the analysis"
    );
  }

  // Deepfake signals — tiered escalation.
  // Boolean detection → HIGH_RISK. Score-based: >=0.85 → HIGH_RISK, >=0.5 → SUSPICIOUS.
  // AI-generated (but not deepfake) is a red flag only.
  let deepfakeDetected = false;
  if (signals.deepfake) {
    const { detected, score, provider, isAiGenerated } = signals.deepfake;

    const booleanDetected = detected === true;
    const scoreDetected =
      typeof score === "number" && score >= DEEPFAKE_DETECTION_THRESHOLD;

    if (booleanDetected || scoreDetected) {
      deepfakeDetected = true;
      if (booleanDetected || (typeof score === "number" && score >= DEEPFAKE_HIGH_RISK_THRESHOLD)) {
        verdict = escalate(verdict, "HIGH_RISK");
      } else {
        verdict = escalate(verdict, "SUSPICIOUS");
      }
      const scoreText = typeof score === "number" ? `, score ${score.toFixed(2)}` : "";
      redFlags.push(`Deepfake indicators detected (${provider}${scoreText})`);
    }

    if (isAiGenerated) {
      redFlags.push(`Image appears to be AI-generated (${provider})`);
    }
  }

  return {
    verdict,
    confidence: signals.ai.confidence,
    summary: signals.ai.summary,
    redFlags,
    nextSteps,
    signals: {
      aiVerdict,
      maliciousUrlCount: maliciousUrls.length,
      injectionDetected,
      deepfakeDetected,
    },
  };
}
