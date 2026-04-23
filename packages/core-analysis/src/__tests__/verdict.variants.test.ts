import { describe, it, expect } from "vitest";
import { mergeVerdict, type VerdictSignals } from "../verdict";

// Contract tests per surface.
//
// Each test captures the signal pattern emitted by one of the 5 current
// verdict-merge copies (web /api/analyze, extension /api/extension/analyze,
// bot @askarthur/bot-core/analyze, media lib/mediaAnalysis,
// extension /api/extension/analyze-ad). When Phase 5 migrates those
// callers to `mergeVerdict`, these tests are the safety net that catches
// any behavioural drift.

describe("mergeVerdict variants — web /api/analyze", () => {
  // Full signal set: AI + URL reputation + redirect chains + injection.
  // Verdict escalation ordering: malicious URL > injection > AI.

  it("SAFE AI + 1 malicious URL → HIGH_RISK with URL red flag and 'no-links' next step", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.85,
        summary: "Looks clean",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [
        { url: "https://evil.test", isMalicious: true, sources: ["google-safebrowsing", "virustotal"] },
      ],
    });
    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.redFlags).toContainEqual(
      expect.stringMatching(/evil\.test/)
    );
    expect(result.nextSteps[0]).toBe("Do not click any links in this message.");
  });

  it("SAFE AI + shortened redirect chain adds informational flag without escalating", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.8,
        summary: "Looks clean",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [], // clean reputation
      redirectChains: [
        {
          originalUrl: "https://bit.ly/abc",
          finalUrl: "https://real-site.test",
          hopCount: 2,
          isShortened: true,
          hasOpenRedirect: false,
          truncated: false,
        },
      ],
    });
    expect(result.verdict).toBe("SAFE"); // redirects don't escalate
    expect(result.redFlags).toContainEqual(expect.stringContaining("Shortened URL"));
  });

  it("SUSPICIOUS AI + injection detected stays SUSPICIOUS with added flag", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SUSPICIOUS",
        confidence: 0.7,
        summary: "Questionable wording",
        redFlags: ["urgent-language"],
        nextSteps: ["verify-sender"],
      },
      injection: { detected: true, patterns: ["Attempted to override system instructions"] },
    });
    expect(result.verdict).toBe("SUSPICIOUS");
    expect(result.signals.injectionDetected).toBe(true);
    expect(result.redFlags).toContain("urgent-language"); // original preserved
    expect(result.redFlags).toContainEqual(expect.stringContaining("manipulation patterns"));
  });

  it("SAFE AI + injection floors to SUSPICIOUS (matches current route.ts:234-241 behaviour)", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.9,
        summary: "Looks clean",
        redFlags: [],
        nextSteps: [],
      },
      injection: { detected: true, patterns: ["x"] },
    });
    expect(result.verdict).toBe("SUSPICIOUS");
  });

  it("HIGH_RISK AI + injection stays HIGH_RISK (injection never downgrades)", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "HIGH_RISK",
        confidence: 0.95,
        summary: "Clear phishing",
        redFlags: ["fake-login"],
        nextSteps: [],
      },
      injection: { detected: true, patterns: ["x"] },
    });
    expect(result.verdict).toBe("HIGH_RISK");
  });

  it("combined malicious URL + injection + open redirect — all signals accumulate", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SUSPICIOUS",
        confidence: 0.6,
        summary: "Mixed indicators",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [
        { url: "https://phish.test", isMalicious: true, sources: ["virustotal"] },
      ],
      redirectChains: [
        {
          originalUrl: "https://redir.test",
          finalUrl: "https://dest.test",
          hopCount: 3,
          isShortened: false,
          hasOpenRedirect: true,
          truncated: false,
        },
      ],
      injection: { detected: true, patterns: ["x"] },
    });
    expect(result.verdict).toBe("HIGH_RISK"); // URL dominates
    expect(result.redFlags).toContainEqual(expect.stringMatching(/phish\.test/));
    expect(result.redFlags).toContainEqual(expect.stringContaining("Open redirect"));
    expect(result.redFlags).toContainEqual(expect.stringContaining("manipulation patterns"));
    expect(result.signals.maliciousUrlCount).toBe(1);
    expect(result.signals.injectionDetected).toBe(true);
  });
});

describe("mergeVerdict variants — extension /api/extension/analyze (text only)", () => {
  // Subset of web: AI + URL reputation + injection. No redirect red flags.

  it("malicious URL escalates to HIGH_RISK matching route.ts:119-131 behaviour", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SUSPICIOUS",
        confidence: 0.5,
        summary: "Uncertain",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [
        { url: "https://bad.test", isMalicious: true, sources: ["google-safebrowsing"] },
      ],
    });
    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.nextSteps).toContain("Do not click any links in this message.");
  });
});

describe("mergeVerdict variants — bot-core /analyze", () => {
  // Subset of web: AI + URL reputation + injection. No redirects.
  // Bot also does a confidence bump — that's a caller-specific policy and
  // is NOT part of mergeVerdict (caller can apply post-merge).

  it("SAFE + malicious URL → HIGH_RISK (matches bot-core/analyze.ts:33-40)", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.8,
        summary: "Looks clean",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [
        { url: "https://mal.test", isMalicious: true, sources: ["vt"] },
      ],
    });
    expect(result.verdict).toBe("HIGH_RISK");
  });
});

describe("mergeVerdict variants — media /lib/mediaAnalysis", () => {
  // Audio transcript path: injection-only check. No URL reputation, no
  // deepfake, no redirects (audio doesn't carry them).
  //
  // Note: the media route uses "This audio contains manipulation..." wording.
  // mergeVerdict uses "This message contains...". Phase 5 migration can
  // either accept the wording change or apply a post-merge string swap.

  it("SAFE transcript + injection in transcript floors to SUSPICIOUS", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.85,
        summary: "Audio transcript looks normal",
        redFlags: [],
        nextSteps: [],
      },
      injection: { detected: true, patterns: ["ignore-instructions"] },
    });
    expect(result.verdict).toBe("SUSPICIOUS");
    expect(result.redFlags).toContainEqual(expect.stringContaining("manipulation patterns"));
  });
});

describe("mergeVerdict variants — extension /api/extension/analyze-ad", () => {
  // Full signal set including deepfake (Hive) and AI-generated image flag.

  it("Hive boolean isDeepfake + clean AI → HIGH_RISK", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.9,
        summary: "Clean ad copy",
        redFlags: [],
        nextSteps: [],
      },
      deepfake: { detected: true, provider: "hive" },
    });
    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.signals.deepfakeDetected).toBe(true);
    expect(result.redFlags).toContainEqual(expect.stringContaining("Deepfake indicators"));
  });

  it("Hive isAiGenerated only → red flag, no verdict escalation", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.9,
        summary: "Ad with AI visuals",
        redFlags: [],
        nextSteps: [],
      },
      deepfake: { isAiGenerated: true, provider: "hive" },
    });
    expect(result.verdict).toBe("SAFE");
    expect(result.signals.deepfakeDetected).toBe(false);
    expect(result.redFlags).toContainEqual(expect.stringContaining("AI-generated"));
  });

  it("score-based provider at 0.9 → HIGH_RISK (Reality Defender / Resemble pattern)", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SUSPICIOUS",
        confidence: 0.6,
        summary: "Ambiguous media",
        redFlags: [],
        nextSteps: [],
      },
      deepfake: { score: 0.9, provider: "reality-defender" },
    });
    expect(result.verdict).toBe("HIGH_RISK");
  });

  it("score-based provider at 0.6 → floors at SUSPICIOUS", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SAFE",
        confidence: 0.9,
        summary: "",
        redFlags: [],
        nextSteps: [],
      },
      deepfake: { score: 0.6, provider: "resemble" },
    });
    expect(result.verdict).toBe("SUSPICIOUS");
    expect(result.redFlags).toContainEqual(expect.stringMatching(/score 0\.60/));
  });

  it("combined: malicious URL + Hive deepfake + injection → HIGH_RISK, all flags", () => {
    const result = mergeVerdict({
      ai: {
        verdict: "SUSPICIOUS",
        confidence: 0.7,
        summary: "Sketchy ad",
        redFlags: [],
        nextSteps: [],
      },
      urlResults: [
        { url: "https://ad-phish.test", isMalicious: true, sources: ["virustotal"] },
      ],
      deepfake: { detected: true, provider: "hive", isAiGenerated: true },
      injection: { detected: true, patterns: ["x"] },
    });
    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.signals.maliciousUrlCount).toBe(1);
    expect(result.signals.deepfakeDetected).toBe(true);
    expect(result.signals.injectionDetected).toBe(true);
    // All three red-flag categories must be present:
    expect(result.redFlags).toContainEqual(expect.stringMatching(/ad-phish\.test/));
    expect(result.redFlags).toContainEqual(expect.stringContaining("Deepfake indicators"));
    expect(result.redFlags).toContainEqual(expect.stringContaining("AI-generated"));
    expect(result.redFlags).toContainEqual(expect.stringContaining("manipulation patterns"));
  });
});
