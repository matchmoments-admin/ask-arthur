/**
 * The validator is the only thing standing between a bad generation and a
 * public, indexed page. A prompt instruction is a request; this is the
 * enforcement. So these tests are written as attacks on it, not as
 * demonstrations that the happy path works.
 *
 * The amount cases are drawn from real prod output: the classifier's existing
 * prompt explicitly permits amounts, and the sampled `modus_operandi` for post
 * 41994 reads "requires a model to pay $95 upfront for shipping a 'hard
 * contract'". If the take writer inherits that habit, this is what catches it.
 */
import { describe, expect, it } from "vitest";

import {
  findContentViolation,
  validateTake,
  type IntentLabel,
  type TakeCandidate,
  type TakeContext,
} from "../reddit-intel/take-validator";

function candidate(over: Partial<TakeCandidate> = {}): TakeCandidate {
  return {
    tells: ["Payment is demanded before any service is delivered"],
    where: "Reported across marketplace and freelance platforms.",
    auLine: null,
    isScamReport: true,
    ...over,
  };
}

function ctx(over: Partial<TakeContext> = {}): TakeContext {
  return {
    intentLabel: "advance_fee" as IntentLabel,
    confidence: 0.88,
    sourceLength: 500,
    ...over,
  };
}

describe("take validator — identifying detail", () => {
  it("passes a clean pattern-level take", () => {
    expect(validateTake(candidate(), ctx())).toEqual({
      status: "ready",
      reason: null,
    });
  });

  it.each([
    ["a bare dollar amount", "Victims are asked to pay $95 up front"],
    ["a spaced amount", "An advance fee of £ 250 is requested"],
    ["a written currency", "The transfer is quoted as 1,200 USD"],
    ["a spelled-out amount", "They ask for 500 dollars before shipping"],
    ["a crypto denomination", "Payment is requested in 0.05 BTC"],
    ["a shorthand amount", "The victim is told to send 20k to release funds"],
  ])("suppresses %s", (_label, text) => {
    const result = validateTake(candidate({ tells: [text] }), ctx());
    expect(result.status).toBe("suppressed");
    expect(result.reason).toBe("contains_amount");
  });

  it("suppresses an email address", () => {
    const r = validateTake(
      candidate({ where: "Contact came from billing@fake-shop.co" }),
      ctx(),
    );
    expect(r).toMatchObject({ status: "suppressed", reason: "contains_email" });
  });

  it("suppresses a phone number", () => {
    const r = validateTake(
      candidate({ auLine: "The callback number given was +61 400 123 456." }),
      ctx(),
    );
    expect(r).toMatchObject({ status: "suppressed", reason: "contains_phone" });
  });

  it.each([
    ["a Reddit handle", "As u/somebody described in the thread"],
    ["a bare u/ handle", "Advice from /u/helper was ignored"],
    ["an @ handle", "The seller operated as @deals_direct"],
  ])("suppresses %s", (_label, text) => {
    const r = validateTake(candidate({ tells: [text] }), ctx());
    expect(r).toMatchObject({ status: "suppressed", reason: "contains_handle" });
  });

  it("does not suppress ordinary numbers that identify nobody", () => {
    // Over-suppression has a cost too: a tell that cannot say "within 24
    // hours" or "a two-week delay" is a worse tell.
    const clean = [
      "Pressure builds over roughly 2 weeks of daily contact",
      "The account was created in 2026 and has no history",
      "Victims are given 24 hours to respond",
    ];
    for (const text of clean) {
      expect(findContentViolation(text), text).toBeNull();
    }
  });

  it("checks every field, not just the tells", () => {
    // A leak in the AU line is exactly as public as a leak in a tell.
    const r = validateTake(
      candidate({ tells: ["clean"], auLine: "Australians paid A$300 each" }),
      ctx(),
    );
    expect(r.status).toBe("suppressed");
  });
});

describe("take validator — tone", () => {
  it.each([
    "You were scammed by a fake recruiter",
    "You've been defrauded and the money is gone",
    "You fell for a classic advance-fee setup",
    "You should have checked the domain first",
    "Your mistake was paying before delivery",
  ])("suppresses an accusation: %s", (text) => {
    const r = validateTake(candidate({ tells: [text] }), ctx());
    expect(r).toMatchObject({
      status: "suppressed",
      reason: "second_person_accusation",
    });
  });

  it("allows second person used as protective advice", () => {
    // The rule targets accusation, not the word "you". Advice framed to the
    // reader is the whole point of the actions panel.
    const advice = [
      "If you are asked to pay before delivery, stop and verify",
      "You can check an ABN on the national register before paying",
    ];
    for (const text of advice) {
      expect(findContentViolation(text), text).toBeNull();
    }
  });
});

describe("take validator — confidence and suitability", () => {
  it("suppresses below the confidence floor", () => {
    const r = validateTake(candidate(), ctx({ confidence: 0.42 }));
    expect(r).toMatchObject({ status: "suppressed", reason: "low_confidence" });
  });

  it("holds 'other' to a higher bar than a specific label", () => {
    const vague = validateTake(
      candidate(),
      ctx({ intentLabel: "other", confidence: 0.6 }),
    );
    expect(vague).toMatchObject({
      status: "suppressed",
      reason: "vague_low_confidence",
    });

    // Same confidence, a label the model actually committed to → shown.
    const specific = validateTake(
      candidate(),
      ctx({ intentLabel: "phishing", confidence: 0.6 }),
    );
    expect(specific.status).toBe("ready");
  });

  it("suppresses when the source is too thin to hold a pattern", () => {
    const r = validateTake(candidate(), ctx({ sourceLength: 120 }));
    expect(r).toMatchObject({
      status: "suppressed",
      reason: "source_too_short",
    });
  });

  it("requires confidence before asserting something is NOT a scam", () => {
    // "Arthur doesn't read this as a scam" is a claim about a real situation
    // and needs the same evidence as the opposite claim.
    const unsure = validateTake(
      candidate({ isScamReport: false }),
      ctx({ confidence: 0.6 }),
    );
    expect(unsure).toMatchObject({
      status: "suppressed",
      reason: "not_a_scam_report_uncertain",
    });

    const confident = validateTake(
      candidate({ isScamReport: false }),
      ctx({ confidence: 0.85 }),
    );
    expect(confident.status).toBe("ready");
  });

  it("suppresses an empty take rather than rendering a heading with nothing under it", () => {
    const r = validateTake(
      candidate({ tells: [], where: null, auLine: null }),
      ctx(),
    );
    expect(r).toMatchObject({ status: "suppressed", reason: "empty_take" });
  });
});

describe("take validator — rule precedence", () => {
  it("reports a content leak even when a confidence rule would also fire", () => {
    // This ordering is load-bearing for the Gate 3 exit criterion "PII
    // validator zero hits". If low confidence masked the leak, the validator's
    // real miss rate would read as zero while leaks were happening.
    const r = validateTake(
      candidate({ tells: ["They asked for $400 via u/scammer"] }),
      ctx({ confidence: 0.2, sourceLength: 50 }),
    );
    expect(r.status).toBe("suppressed");
    expect(["contains_amount", "contains_handle"]).toContain(r.reason);
  });
});

/**
 * Adversarial suite. These strings are what a model plausibly writes, not what
 * makes the implementation look good — the first version of the amount rule
 * passed every test above and still missed the two most likely prose forms of
 * an amount, which is how this suite came to exist.
 */
describe("take validator — adversarial", () => {
  it.each([
    ["a bare number in a money context", "The seller asked for 1500 up front"],
    ["a fee with no symbol", "A fee of 95 is requested before delivery"],
    ["a spelled-out amount", "They asked for two hundred dollars"],
    ["a localised symbol", "A payment of ¥50000 was demanded"],
    ["a prefixed currency", "The victim transferred AU$2,000"],
    ["an obfuscated address", "Contact came from billing at fakeshop dot com"],
    ["an international number", "Message came from +1 (555) 019-2837"],
    ["a local mobile", "Reach them on 0400123456"],
  ])("catches %s", (_label, text) => {
    expect(findContentViolation(text), text).not.toBeNull();
  });

  it.each([
    "Payment is requested before any service is delivered",
    "Pressure builds over roughly 2 weeks of daily contact",
    "The account was created in 2026 with no history",
    "Victims are given 24 hours to respond",
    "A 3-step verification flow is imitated",
    "Contact moves off-platform within the first 48 hours",
    "Delivery is promised in 5 to 7 days and never arrives",
    "Reported across 4 unrelated marketplaces",
    "Fees are re-described as tax, insurance, then release charges",
    // Deliberately vague magnitude: non-identifying by design, and useful.
    "Losses reached a five-figure sum",
  ])("does not over-suppress a legitimate tell: %s", (text) => {
    expect(findContentViolation(text), text).toBeNull();
  });

  it("documents the two classes it CANNOT catch", () => {
    // Not aspirational tests — these assert the CURRENT, KNOWN limits so the
    // mesh size is visible in the suite rather than discovered in production.
    // If either starts passing, that is an improvement: update this test.
    // The compensating controls are the prompt and the review queue's `pii`
    // verdict, and no doc may describe this module as a PII guarantee.
    expect(findContentViolation("The scammer went by Sarah Mitchell")).toBeNull();
    expect(
      findContentViolation("They used the handle deals_direct on Telegram"),
    ).toBeNull();
  });
});
