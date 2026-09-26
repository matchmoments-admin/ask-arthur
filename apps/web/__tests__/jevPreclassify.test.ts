import { describe, expect, it } from "vitest";
import type { JevAnswer } from "@askarthur/scam-engine/providers/jev";

import {
  ClassificationOutputSchema,
  SYSTEM_PROMPT,
} from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";
import {
  JEV_PROMPT_VERSION,
  JevAnswerShapeError,
  buildJevPreclassifyQuestions,
  buildJevState,
  mapJevAnswersToRow,
  riskQuestionId,
  toClassificationRow,
  toClassificationRpcArgs,
  toJevRpcArgs,
} from "@/lib/clone-watch/jev-preclassify";
import {
  IS_CLONE_MIN_P,
  RISK_INDICATOR_MIN_P,
  WORKLIST_MIN_CONFIDENCE,
} from "@/lib/clone-watch/preclassify-thresholds";
import {
  ATTACK_INTENT_VALUES,
  CLONE_TACTIC_VALUES,
  RISK_INDICATOR_VALUES,
} from "@/lib/clone-watch/preclassify-vocabulary";

// The shadow lane is only a valid comparison if both classifiers answer in
// the same vocabulary. These guards make drift a failing test in BOTH
// directions, and pin the Haiku prompt text (which spells the values out
// by hand) to the same list.

function goodAnswers(): Record<string, JevAnswer> {
  const answers: Record<string, JevAnswer> = {
    is_clone: { type: "noul", noul: 0.87 },
    clone_tactic: {
      type: "choice",
      choice: "brandjack",
      probabilities: { brandjack: 0.7, typosquat: 0.2, unrelated: 0.1 },
      confidence: 0.55,
    },
    attack_intent: {
      type: "choice",
      choice: "credential_phishing",
      probabilities: { credential_phishing: 0.9, unknown: 0.1 },
      confidence: 0.8,
    },
  };
  for (const ri of RISK_INDICATOR_VALUES) {
    answers[riskQuestionId(ri)] = {
      type: "noul",
      noul: ri === "urgency_words" ? 0.95 : 0.05,
    };
  }
  return answers;
}

describe("vocabulary drift guards", () => {
  it("the Haiku Zod schema and the vocabulary module agree exactly", () => {
    const shape = ClassificationOutputSchema.shape;
    expect([...shape.clone_tactic.options].sort()).toEqual(
      [...CLONE_TACTIC_VALUES].sort(),
    );
    expect([...shape.attack_intent.options].sort()).toEqual(
      [...ATTACK_INTENT_VALUES].sort(),
    );
    const riEnum = shape.risk_indicators.def.innerType.def.element;
    expect([...riEnum.options].sort()).toEqual(
      [...RISK_INDICATOR_VALUES].sort(),
    );
  });

  it("the Haiku SYSTEM_PROMPT names every vocabulary value", () => {
    for (const v of [
      ...CLONE_TACTIC_VALUES,
      ...ATTACK_INTENT_VALUES,
      ...RISK_INDICATOR_VALUES,
    ]) {
      expect(SYSTEM_PROMPT, `SYSTEM_PROMPT is missing "${v}"`).toContain(v);
    }
  });

  it("the Jev question set covers the vocabulary and nothing else", () => {
    const q = buildJevPreclassifyQuestions();
    const tactic = q.clone_tactic;
    const intent = q.attack_intent;
    if (tactic?.type !== "choice" || intent?.type !== "choice")
      throw new Error("expected choice questions");
    expect(Object.keys(tactic.criteria).sort()).toEqual(
      [...CLONE_TACTIC_VALUES].sort(),
    );
    expect(Object.keys(intent.criteria).sort()).toEqual(
      [...ATTACK_INTENT_VALUES].sort(),
    );

    const riIds = RISK_INDICATOR_VALUES.map(riskQuestionId);
    for (const id of riIds)
      expect(q[id], `missing question ${id}`).toBeDefined();
    for (const id of riIds) expect(q[id]?.type).toBe("noul");

    expect(q.is_clone?.type).toBe("noul");
    // The API 422s on a string here (`model_attributes_type`, 2026-09-22):
    // noul criteria must be the { true, false } pair or nothing.
    if (q.is_clone?.type === "noul") {
      expect(q.is_clone.criteria).toEqual({
        true: expect.any(String),
        false: expect.any(String),
      });
    }
    expect(Object.keys(q)).toHaveLength(3 + RISK_INDICATOR_VALUES.length);
  });

  it("every criteria description is non-empty prose (Jev reads it)", () => {
    const q = buildJevPreclassifyQuestions();
    for (const question of Object.values(q)) {
      expect(question.instructions.trim().length).toBeGreaterThan(20);
      if (question.type === "choice") {
        for (const [k, desc] of Object.entries(question.criteria)) {
          expect(
            desc.trim().length,
            `criteria "${k}" is empty`,
          ).toBeGreaterThan(5);
        }
      }
    }
  });
});

describe("buildJevState", () => {
  it("is the exact field set Haiku sees, same key names", () => {
    expect(
      buildJevState({
        brand: "nab.com.au",
        candidateDomain: "nab-secure.com",
        candidateUrl: "http://nab-secure.com",
      }),
    ).toEqual({
      brand: "nab.com.au",
      candidate_domain: "nab-secure.com",
      candidate_url: "http://nab-secure.com",
    });
  });
});

describe("mapJevAnswersToRow", () => {
  it("maps a full answer set to the row", () => {
    const row = mapJevAnswersToRow(goodAnswers());
    expect(row.is_clone_p).toBe(0.87);
    expect(row.clone_tactic).toBe("brandjack");
    expect(row.clone_tactic_conf).toBe(0.55);
    expect(row.clone_tactic_probs.typosquat).toBe(0.2);
    expect(row.attack_intent).toBe("credential_phishing");
    expect(row.attack_intent_conf).toBe(0.8);
    expect(row.risk_indicator_probs.urgency_words).toBe(0.95);
    expect(row.risk_indicator_probs.suspicious_tld).toBe(0.05);
    expect(Object.keys(row.risk_indicator_probs).sort()).toEqual(
      [...RISK_INDICATOR_VALUES].sort(),
    );
  });

  it("throws (never a half-row) when an answer is missing", () => {
    const a = goodAnswers();
    delete a[riskQuestionId("suspicious_tld")];
    expect(() => mapJevAnswersToRow(a)).toThrow(JevAnswerShapeError);
  });

  it("throws when a choice is outside the vocabulary", () => {
    const a = goodAnswers();
    a.clone_tactic = {
      type: "choice",
      choice: "vibes",
      probabilities: { vibes: 1 },
      confidence: 1,
    };
    expect(() => mapJevAnswersToRow(a)).toThrow(/not in vocabulary/);
  });

  it("throws when an answer has the wrong type", () => {
    const a = goodAnswers();
    a.is_clone = {
      type: "choice",
      choice: "yes",
      probabilities: { yes: 1 },
      confidence: 1,
    };
    expect(() => mapJevAnswersToRow(a)).toThrow(/expected noul/);
  });

  it("rejects an out-of-range probability instead of clamping it (a vendor regression must be visible)", () => {
    const a = goodAnswers();
    a.is_clone = { type: "noul", noul: 1.0000001 };
    expect(() => mapJevAnswersToRow(a)).toThrow(/not a probability/);
    const b = goodAnswers();
    b.clone_tactic = {
      type: "choice",
      choice: "brandjack",
      probabilities: { brandjack: -0.2 },
      confidence: 0.5,
    };
    expect(() => mapJevAnswersToRow(b)).toThrow(/probabilities\.brandjack/);
  });
});

describe("toJevRpcArgs", () => {
  it("produces the record_clone_watch_jev_classification parameter set", () => {
    const args = toJevRpcArgs({
      alertId: 42,
      brand: "nab.com.au",
      candidateDomain: "nab-secure.com",
      row: mapJevAnswersToRow(goodAnswers()),
      modelId: "jev-1.13.0",
      source: "backfill",
      inputTokens: 210,
      latencyMs: 180,
    });
    expect(Object.keys(args).sort()).toEqual(
      [
        "p_alert_id",
        "p_brand",
        "p_candidate_domain",
        "p_is_clone_p",
        "p_clone_tactic",
        "p_clone_tactic_conf",
        "p_clone_tactic_probs",
        "p_attack_intent",
        "p_attack_intent_conf",
        "p_attack_intent_probs",
        "p_risk_indicator_probs",
        "p_model_id",
        "p_prompt_version",
        "p_source",
        "p_input_tokens",
        "p_latency_ms",
      ].sort(),
    );
    expect(args.p_prompt_version).toBe(JEV_PROMPT_VERSION);
    expect(args.p_source).toBe("backfill");
    expect(args.p_alert_id).toBe(42);
  });
});

describe("toClassificationRow (ADR-0026 — the v157 shape from Jev answers)", () => {
  it("is_clone flips exactly at IS_CLONE_MIN_P and confidence carries P(clone)", () => {
    const base = mapJevAnswersToRow(goodAnswers());
    const below = toClassificationRow({
      ...base,
      is_clone_p: IS_CLONE_MIN_P - 0.01,
    });
    const at = toClassificationRow({ ...base, is_clone_p: IS_CLONE_MIN_P });
    expect(below.is_clone).toBe(false);
    expect(below.confidence).toBeCloseTo(IS_CLONE_MIN_P - 0.01, 10);
    expect(at.is_clone).toBe(true);
    expect(at.confidence).toBe(IS_CLONE_MIN_P);
  });

  it("lists risk indicators at or above RISK_INDICATOR_MIN_P, in vocabulary order", () => {
    const base = mapJevAnswersToRow(goodAnswers());
    const probs = { ...base.risk_indicator_probs };
    probs.suspicious_tld = RISK_INDICATOR_MIN_P;
    probs.urgency_words = 0.95;
    probs.login_form_url = RISK_INDICATOR_MIN_P - 0.01;
    const c = toClassificationRow({ ...base, risk_indicator_probs: probs });
    expect(c.risk_indicators).toEqual(
      RISK_INDICATOR_VALUES.filter((ri) => probs[ri] >= RISK_INDICATOR_MIN_P),
    );
    expect(c.risk_indicators).toContain("urgency_words");
    expect(c.risk_indicators).toContain("suspicious_tld");
    expect(c.risk_indicators).not.toContain("login_form_url");
  });

  it("synthesises a deterministic reason from the probabilities", () => {
    const c = toClassificationRow(mapJevAnswersToRow(goodAnswers()));
    expect(c.reason).toBe(
      "jev p=0.87 · brandjack (0.70) · credential_phishing (0.90) · urgency_words",
    );
    expect(c.clone_tactic).toBe("brandjack");
    expect(c.attack_intent).toBe("credential_phishing");
  });

  it("produces the record_clone_watch_classification (v157) parameter set", () => {
    const args = toClassificationRpcArgs({
      alertId: 7,
      brand: "nab.com.au",
      candidateDomain: "nab-secure.com",
      classification: toClassificationRow(mapJevAnswersToRow(goodAnswers())),
      modelId: "jev-1.13.0",
      inputTokens: 1100,
    });
    expect(Object.keys(args).sort()).toEqual(
      [
        "p_alert_id",
        "p_brand",
        "p_candidate_domain",
        "p_is_clone",
        "p_confidence",
        "p_clone_tactic",
        "p_attack_intent",
        "p_risk_indicators",
        "p_reason",
        "p_model_id",
        "p_prompt_version",
        "p_input_tokens",
        "p_output_tokens",
      ].sort(),
    );
    expect(args.p_model_id).toBe("jev-1.13.0");
    expect(args.p_prompt_version).toBe(JEV_PROMPT_VERSION);
    expect(args.p_output_tokens).toBe(0);
  });

  it("thresholds are ordered so a gate can never admit a non-clone", () => {
    expect(IS_CLONE_MIN_P).toBeLessThanOrEqual(WORKLIST_MIN_CONFIDENCE);
    expect(WORKLIST_MIN_CONFIDENCE).toBeLessThanOrEqual(1);
  });
});
