import { describe, it, expect } from "vitest";
import {
  DOCUMENT_CHECK_CLEAN_COPY,
  DOCUMENT_CHECK_CLEAN_LABEL,
  DOCUMENT_CHECK_COPY,
  DOCUMENT_CHECK_DISCLAIMER,
  DOCUMENT_CHECK_UNAVAILABLE_COPY,
  DOCUMENT_CHECK_VOLUME_CTA,
  documentCheckRateLimitCopy,
  DOCUMENT_FINDING_SIGNALS,
} from "@askarthur/types";

// The Document Check honesty guardrail (ADR-0015/0024 epistemics, sibling of
// imageCheckOriginCopy.test.ts): findings are named signals, never a
// verdict. This test fails the build when any copy string claims a document
// is fake/genuine/forged/verified, and when the clean-scan copy loses the
// asymmetry caveat — a fraudulent document generated from scratch carries no
// editing traces, so "no findings" must never read as "safe".

const BANNED_VERDICTS = [
  /\bgenuine\b/i,
  /\bauthentic\b/i,
  /\bis fake\b/i,
  /\bfake document\b/i,
  /\bforged\b/i,
  /\bforgery\b/i,
  /\bverified\b/i,
  /\blegitimate document\b/i,
  /\bsafe\b/i,
];

describe("document-check copy — no verdict language", () => {
  it("every finding signal has non-empty label and explain copy", () => {
    for (const signal of DOCUMENT_FINDING_SIGNALS) {
      const copy = DOCUMENT_CHECK_COPY[signal];
      expect(copy, `missing copy for ${signal}`).toBeDefined();
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.explain.length).toBeGreaterThan(10);
    }
  });

  it("no finding copy renders a FAKE/GENUINE verdict", () => {
    for (const signal of DOCUMENT_FINDING_SIGNALS) {
      const copy = DOCUMENT_CHECK_COPY[signal];
      for (const re of BANNED_VERDICTS) {
        expect(copy.label, `${signal} label matches ${re}`).not.toMatch(re);
        expect(copy.explain, `${signal} explain matches ${re}`).not.toMatch(re);
      }
    }
  });

  it("clean-scan copy carries the asymmetry caveat verbatim in spirit", () => {
    // The load-bearing pieces: traces-absent ≠ document-real, and the
    // from-scratch fraud case is named explicitly.
    expect(DOCUMENT_CHECK_CLEAN_COPY).toMatch(/no editing traces/i);
    expect(DOCUMENT_CHECK_CLEAN_COPY).toMatch(/not that the document is real/i);
    expect(DOCUMENT_CHECK_CLEAN_COPY).toMatch(/from scratch|freshly|no revision history/i);
    for (const re of BANNED_VERDICTS) {
      expect(DOCUMENT_CHECK_CLEAN_COPY).not.toMatch(re);
    }
  });

  it("rate-limit copy explains the allowance and when it frees up — never a bare refusal", () => {
    const withReset = documentCheckRateLimitCopy(5, 12);
    // States the real allowance and a concrete wait, so the user knows why
    // and what to do — the old copy said only "too many checks".
    expect(withReset).toMatch(/limited to 5 an hour/i);
    expect(withReset).toMatch(/12 minutes/);
    expect(documentCheckRateLimitCopy(5, 1)).toMatch(/1 minute\b/);
    // Unknown reset must still be actionable, never a dead end.
    expect(documentCheckRateLimitCopy(5, null)).toMatch(/shortly/i);
    // It is a plan boundary, not a fault: no blame, no verdict language.
    for (const re of [...BANNED_VERDICTS, /error/i, /failed/i]) {
      expect(withReset).not.toMatch(re);
    }
    // The CTA must not promise a checkout page — self-serve billing is dark.
    expect(DOCUMENT_CHECK_VOLUME_CTA).not.toMatch(/buy|upgrade|subscribe|pricing/i);
  });

  it("clean-state heading and unavailable copy carry no verdict language", () => {
    for (const s of [DOCUMENT_CHECK_CLEAN_LABEL, DOCUMENT_CHECK_UNAVAILABLE_COPY]) {
      for (const re of BANNED_VERDICTS) {
        expect(s).not.toMatch(re);
      }
    }
    // The heading states what was FOUND, never what the document IS.
    expect(DOCUMENT_CHECK_CLEAN_LABEL).toMatch(/traces/i);
    // Could-not-run copy must say the non-result means nothing either way.
    expect(DOCUMENT_CHECK_UNAVAILABLE_COPY).toMatch(/nothing about the document/i);
  });

  it("disclaimer says these are signals, not a verdict, and routes to independent verification", () => {
    expect(DOCUMENT_CHECK_DISCLAIMER).toMatch(/not a verdict/i);
    expect(DOCUMENT_CHECK_DISCLAIMER).toMatch(/independent/i);
    for (const re of BANNED_VERDICTS) {
      expect(DOCUMENT_CHECK_DISCLAIMER).not.toMatch(re);
    }
  });

  it("softening findings copy is hedged — legitimate causes are acknowledged", () => {
    // multiple_revisions and producer_office_suite both have benign causes;
    // their copy must acknowledge them (the anti-false-accusation rule).
    expect(DOCUMENT_CHECK_COPY.multiple_revisions.explain).toMatch(/legitimate|e-sign|stamp/i);
    expect(DOCUMENT_CHECK_COPY.producer_office_suite.explain).toMatch(/do issue|small business/i);
    expect(DOCUMENT_CHECK_COPY.encrypted_document.explain).toMatch(/not suspicious/i);
  });
});
