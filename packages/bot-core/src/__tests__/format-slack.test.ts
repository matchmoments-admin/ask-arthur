import { describe, it, expect } from "vitest";
import { toSlackBlocks } from "../format-slack";
import type { AnalysisResult } from "@askarthur/types";

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  verdict: "HIGH_RISK",
  confidence: 0.88,
  summary: "This is a phishing attempt.",
  redFlags: ["Fake URL", "Brand impersonation"],
  nextSteps: ["Delete immediately.", "Report to IT."],
  scamType: "phishing",
  channel: "email",
  ...overrides,
});

describe("toSlackBlocks", () => {
  it("returns ephemeral response type", () => {
    const response = toSlackBlocks(makeResult());
    expect(response.response_type).toBe("ephemeral");
  });

  it("includes colored attachment", () => {
    const response = toSlackBlocks(makeResult());
    expect(response.attachments).toHaveLength(1);
    expect(response.attachments[0].color).toBe("#ef4444"); // HIGH_RISK red
  });

  it("includes header block with verdict", () => {
    const response = toSlackBlocks(makeResult());
    const blocks = response.attachments[0].blocks;
    const header = blocks.find((b) => b.type === "header");
    expect(header?.text?.text).toContain("HIGH RISK");
    expect(header?.text?.text).toContain("88%");
  });

  it("includes summary section", () => {
    const response = toSlackBlocks(makeResult());
    const blocks = response.attachments[0].blocks;
    const sections = blocks.filter((b) => b.type === "section");
    const summaryBlock = sections.find((s) => s.text?.text === "This is a phishing attempt.");
    expect(summaryBlock).toBeDefined();
  });

  it("includes red flags", () => {
    const response = toSlackBlocks(makeResult());
    const blocks = response.attachments[0].blocks;
    const flagBlock = blocks.find((b) => b.text?.text?.includes("*Red Flags:*"));
    expect(flagBlock).toBeDefined();
    expect(flagBlock?.text?.text).toContain("Fake URL");
  });

  it("includes metadata fields", () => {
    const response = toSlackBlocks(makeResult());
    const blocks = response.attachments[0].blocks;
    const fieldsBlock = blocks.find((b) => b.fields);
    expect(fieldsBlock?.fields?.some((f) => f.text.includes("phishing"))).toBe(true);
  });

  it("uses green color for SAFE verdict", () => {
    const response = toSlackBlocks(makeResult({ verdict: "SAFE" }));
    expect(response.attachments[0].color).toBe("#22c55e");
  });

  it("includes context footer", () => {
    const response = toSlackBlocks(makeResult());
    const blocks = response.attachments[0].blocks;
    const context = blocks.find((b) => b.type === "context");
    expect(context?.elements?.[0]?.text).toContain("Ask Arthur");
  });
});
