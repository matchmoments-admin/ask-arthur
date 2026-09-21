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
  toJevRpcArgs,
} from "@/lib/clone-watch/jev-preclassify";
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
