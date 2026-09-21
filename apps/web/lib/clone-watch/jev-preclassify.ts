// Jev shadow-lane rubric for the clone-watch pre-classifier (v311).
//
// Pure: builds the question set Jev is asked about a candidate domain and
// maps the answers to the `record_clone_watch_jev_classification` row. No
// I/O — the live step (clone-watch-haiku-preclassify) and the backfill
// script (scripts/backfill-jev-classifications.ts) both call these so the
// day-1 backfill curve and the live confirmation curve come from ONE rubric.
//
// The state is byte-for-byte the fields Haiku sees (`userMessage` in the
// fn: brand, candidate_domain, candidate_url) so the calibration
// comparison is apples to apples. Questions:
//   is_clone         noul   — P(registered to impersonate the brand for fraud)
//   clone_tactic     choice — same 9 options as Haiku
//   attack_intent    choice — same 8 options
//   ri_<indicator>   noul   — one per risk indicator, a probability each
//
// Bump JEV_PROMPT_VERSION on ANY wording change; it is persisted per row so
// cohorts stay separable (the same discipline as the Haiku PROMPT_VERSION).

import type {
  JevAnswer,
  JevQuestion,
} from "@askarthur/scam-engine/providers/jev";

import {
  ATTACK_INTENTS,
  ATTACK_INTENT_VALUES,
  CLONE_TACTICS,
  CLONE_TACTIC_VALUES,
  RISK_INDICATORS,
  RISK_INDICATOR_VALUES,
  type AttackIntent,
  type CloneTactic,
  type RiskIndicator,
} from "./preclassify-vocabulary";

export const JEV_PROMPT_VERSION = "jev-v1";

const RISK_QUESTION_PREFIX = "ri_";

/** Question id for one risk indicator — the join key between the question set and the row mapping. */
export function riskQuestionId(indicator: RiskIndicator): string {
  return `${RISK_QUESTION_PREFIX}${indicator}`;
}

export interface JevPreclassifyInput {
  brand: string;
  candidateDomain: string;
  candidateUrl: string;
}

/** The exact fields Haiku sees, same key names, same order. */
export function buildJevState(
  input: JevPreclassifyInput,
): Record<string, string> {
  return {
    brand: input.brand,
    candidate_domain: input.candidateDomain,
    candidate_url: input.candidateUrl,
  };
}

export function buildJevPreclassifyQuestions(): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    is_clone: {
      type: "noul",
      instructions:
        "The `candidate_domain` was registered with deliberate intent to impersonate the `brand` (an Australian brand's legitimate domain) for fraudulent purposes.",
      criteria: {
        true: "A deliberate lookalike of the brand built to deceive its customers.",
        false:
          "Coincidental name overlap, a dictionary word, a parked domain, or a legitimate subsidiary or reseller.",
      },
    },
    clone_tactic: {
      type: "choice",
      instructions:
        "Which lookalike technique does the `candidate_domain` use against the `brand`? Pick `unrelated` or `parked` when it is not a clone.",
      criteria: { ...CLONE_TACTICS },
    },
    attack_intent: {
      type: "choice",
      instructions:
        "If the `candidate_domain` were used against the brand's customers, what would the attack most likely be? Judge from the domain and URL only.",
      criteria: { ...ATTACK_INTENTS },
    },
  };
  for (const indicator of RISK_INDICATOR_VALUES) {
    questions[riskQuestionId(indicator)] = {
      type: "noul",
      instructions: `Risk indicator present in the \`candidate_domain\` or \`candidate_url\`: ${RISK_INDICATORS[indicator]}.`,
    };
  }
  return questions;
}

/** The RPC-shaped row, minus the caller-owned columns (alert id, model, source, tokens, latency). */
export interface JevPreclassifyRow {
  is_clone_p: number;
  clone_tactic: CloneTactic;
  clone_tactic_conf: number;
  clone_tactic_probs: Record<string, number>;
  attack_intent: AttackIntent;
  attack_intent_conf: number;
  attack_intent_probs: Record<string, number>;
  risk_indicator_probs: Record<RiskIndicator, number>;
}

export class JevAnswerShapeError extends Error {
  constructor(message: string) {
    super(`jev-preclassify: ${message}`);
    this.name = "JevAnswerShapeError";
  }
}

function requireAnswer(
  answers: Record<string, JevAnswer>,
  id: string,
): JevAnswer {
  const a = answers[id];
  if (!a) throw new JevAnswerShapeError(`missing answer "${id}"`);
  return a;
}

function requireNoul(answers: Record<string, JevAnswer>, id: string): number {
  const a = requireAnswer(answers, id);
  if (a.type !== "noul")
    throw new JevAnswerShapeError(`answer "${id}" is ${a.type}, expected noul`);
  return requireProbability(a.noul, `answer "${id}".noul`);
}

function requireChoice<T extends string>(
  answers: Record<string, JevAnswer>,
  id: string,
  allowed: readonly T[],
): { choice: T; confidence: number; probabilities: Record<string, number> } {
  const a = requireAnswer(answers, id);
  if (a.type !== "choice")
    throw new JevAnswerShapeError(
      `answer "${id}" is ${a.type}, expected choice`,
    );
  if (!(allowed as readonly string[]).includes(a.choice)) {
    throw new JevAnswerShapeError(
      `answer "${id}" chose "${a.choice}", not in vocabulary`,
    );
  }
  for (const [k, v] of Object.entries(a.probabilities)) {
    requireProbability(v, `answer "${id}".probabilities.${k}`);
  }
  return {
    choice: a.choice as T,
    confidence: requireProbability(a.confidence, `answer "${id}".confidence`),
    probabilities: a.probabilities,
  };
}

/**
 * A probability outside [0, 1] is a vendor regression, and this lane exists
 * to MEASURE the vendor — so it is an error (lands as `bad_answers`), never a
 * silent clamp that would hide it from the calibration curve.
 */
function requireProbability(n: number, what: string): number {
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new JevAnswerShapeError(`${what} is not a probability: ${String(n)}`);
  }
  return n;
}

/**
 * Map a Jev response's `answers` to the row columns. Throws
 * `JevAnswerShapeError` on any missing/mistyped/out-of-vocabulary answer so
 * the caller records an error, never a half-row.
 */
export function mapJevAnswersToRow(
  answers: Record<string, JevAnswer>,
): JevPreclassifyRow {
  const tactic = requireChoice(answers, "clone_tactic", CLONE_TACTIC_VALUES);
  const intent = requireChoice(answers, "attack_intent", ATTACK_INTENT_VALUES);
  const risk = {} as Record<RiskIndicator, number>;
  for (const indicator of RISK_INDICATOR_VALUES) {
    risk[indicator] = requireNoul(answers, riskQuestionId(indicator));
  }
  return {
    is_clone_p: requireNoul(answers, "is_clone"),
    clone_tactic: tactic.choice,
    clone_tactic_conf: tactic.confidence,
    clone_tactic_probs: tactic.probabilities,
    attack_intent: intent.choice,
    attack_intent_conf: intent.confidence,
    attack_intent_probs: intent.probabilities,
    risk_indicator_probs: risk,
  };
}

/** RPC argument object for `record_clone_watch_jev_classification`. */
export function toJevRpcArgs(args: {
  alertId: number;
  brand: string;
  candidateDomain: string;
  row: JevPreclassifyRow;
  modelId: string;
  source: "live" | "backfill";
  inputTokens: number;
  latencyMs: number;
}): Record<string, unknown> {
  return {
    p_alert_id: args.alertId,
    p_brand: args.brand,
    p_candidate_domain: args.candidateDomain,
    p_is_clone_p: args.row.is_clone_p,
    p_clone_tactic: args.row.clone_tactic,
    p_clone_tactic_conf: args.row.clone_tactic_conf,
    p_clone_tactic_probs: args.row.clone_tactic_probs,
    p_attack_intent: args.row.attack_intent,
    p_attack_intent_conf: args.row.attack_intent_conf,
    p_attack_intent_probs: args.row.attack_intent_probs,
    p_risk_indicator_probs: args.row.risk_indicator_probs,
    p_model_id: args.modelId,
    p_prompt_version: JEV_PROMPT_VERSION,
    p_source: args.source,
    p_input_tokens: args.inputTokens,
    p_latency_ms: args.latencyMs,
  };
}
