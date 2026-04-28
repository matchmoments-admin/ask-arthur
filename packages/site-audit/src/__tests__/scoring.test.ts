import { describe, it, expect } from "vitest";
import {
  calculateGrade,
  calculateScore,
  calculateCategoryScores,
  generateRecommendations,
} from "../scoring";
import type { CheckResult } from "../types";

describe("calculateGrade", () => {
  it("returns A+ for score >= 95", () => {
    expect(calculateGrade(95)).toBe("A+");
    expect(calculateGrade(100)).toBe("A+");
  });

  it("returns A for score 80-94", () => {
    expect(calculateGrade(80)).toBe("A");
    expect(calculateGrade(94)).toBe("A");
  });

  it("returns B for score 65-79", () => {
    expect(calculateGrade(65)).toBe("B");
    expect(calculateGrade(79)).toBe("B");
  });

  it("returns C for score 50-64", () => {
    expect(calculateGrade(50)).toBe("C");
    expect(calculateGrade(64)).toBe("C");
  });

  it("returns D for score 35-49", () => {
    expect(calculateGrade(35)).toBe("D");
    expect(calculateGrade(49)).toBe("D");
  });

  it("returns F for score < 35", () => {
    expect(calculateGrade(0)).toBe("F");
    expect(calculateGrade(34)).toBe("F");
  });
});

describe("calculateCategoryScores", () => {
  it("groups checks by category", () => {
    const checks: CheckResult[] = [
      { id: "hsts", category: "headers", label: "HSTS", status: "pass", score: 15, maxScore: 15, details: "" },
      { id: "xcto", category: "headers", label: "XCTO", status: "pass", score: 5, maxScore: 5, details: "" },
      { id: "csp", category: "csp", label: "CSP", status: "fail", score: 0, maxScore: 10, details: "" },
    ];
    const categories = calculateCategoryScores(checks);

    const headersCat = categories.find((c) => c.category === "headers");
    expect(headersCat).toBeDefined();
    expect(headersCat!.score).toBe(20);
    expect(headersCat!.maxScore).toBe(20);
    expect(headersCat!.grade).toBe("A+");

    const cspCat = categories.find((c) => c.category === "csp");
    expect(cspCat).toBeDefined();
    expect(cspCat!.score).toBe(0);
    expect(cspCat!.grade).toBe("F");
  });
});

describe("calculateScore", () => {
  it("returns 100 for perfect scores", () => {
    const checks: CheckResult[] = [
      { id: "h1", category: "https", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
      { id: "h2", category: "headers", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
      { id: "h3", category: "csp", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
      { id: "h4", category: "permissions", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
      { id: "h5", category: "server", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
      { id: "h6", category: "content", label: "", status: "pass", score: 10, maxScore: 10, details: "" },
    ];
    const categories = calculateCategoryScores(checks);
    expect(calculateScore(categories)).toBe(100);
  });

  it("returns 0 for all failing scores", () => {
    const checks: CheckResult[] = [
      { id: "h1", category: "https", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
      { id: "h2", category: "headers", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
      { id: "h3", category: "csp", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
      { id: "h4", category: "permissions", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
      { id: "h5", category: "server", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
      { id: "h6", category: "content", label: "", status: "fail", score: 0, maxScore: 10, details: "" },
    ];
    const categories = calculateCategoryScores(checks);
    expect(calculateScore(categories)).toBe(0);
  });
});

describe("generateRecommendations", () => {
  it("returns recommendations for failed checks", () => {
    const checks: CheckResult[] = [
      { id: "hsts", category: "headers", label: "HSTS", status: "fail", score: 0, maxScore: 15, details: "" },
      { id: "csp-present", category: "csp", label: "CSP", status: "fail", score: 0, maxScore: 10, details: "" },
    ];
    const recs = generateRecommendations(checks);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].text).toContain("Strict-Transport-Security");
  });

  it("returns empty array for all passing checks", () => {
    const checks: CheckResult[] = [
      { id: "hsts", category: "headers", label: "HSTS", status: "pass", score: 15, maxScore: 15, details: "" },
    ];
    const recs = generateRecommendations(checks);
    expect(recs).toHaveLength(0);
  });

  it("prioritizes fails over warns", () => {
    const checks: CheckResult[] = [
      { id: "server-info", category: "server", label: "Server", status: "warn", score: 3, maxScore: 5, details: "" },
      { id: "hsts", category: "headers", label: "HSTS", status: "fail", score: 0, maxScore: 15, details: "" },
    ];
    const recs = generateRecommendations(checks);
    expect(recs[0].text).toContain("Strict-Transport-Security");
  });
});
