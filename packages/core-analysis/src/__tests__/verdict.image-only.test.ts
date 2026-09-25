import { describe, expect, it } from "vitest";
import {
  IMAGE_ONLY_NEXT_STEP,
  isImageOnlySubmission,
  mergeVerdict,
  type AiSignal,
} from "../verdict";

// Founder decision 2026-09-25: an image-only submission never returns SAFE.
// Text the scammer prints inside an image is invisible to the text injection
// pre-filter, so the model's SAFE is uncorroborated — it becomes UNCERTAIN.

const ai = (verdict: AiSignal["verdict"], confidence = 0.95): AiSignal => ({
  verdict,
  confidence,
  summary: "s",
  redFlags: [],
  nextSteps: ["existing step"],
});

describe("isImageOnlySubmission — the one definition", () => {
  it.each([
    [undefined, 1, true],
    [null, 2, true],
    ["", 1, true],
    ["   \n\t", 1, true],
    ["is this real?", 1, false], // a typed caption is text
    ["", 0, false], // no image, no text: not image-only
    ["hello", 0, false],
  ])("text %j with %d image(s) → %s", (text, n, expected) => {
    expect(isImageOnlySubmission(text as string | null | undefined, n)).toBe(expected);
  });
});

describe("mergeVerdict — image-only floor", () => {
  it("lowers a confident image-only SAFE to UNCERTAIN with the fixed next step first", () => {
    const r = mergeVerdict({ ai: ai("SAFE"), imageOnly: true });
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.nextSteps[0]).toBe(IMAGE_ONLY_NEXT_STEP);
    expect(r.nextSteps).toContain("existing step");
    expect(r.signals.imageOnlyDowngraded).toBe(true);
    expect(r.signals.aiVerdict).toBe("SAFE");
  });

  it.each(["UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"] as const)(
    "leaves %s unchanged on image-only input",
    (v) => {
      const r = mergeVerdict({ ai: ai(v), imageOnly: true });
      expect(r.verdict).toBe(v);
      expect(r.signals.imageOnlyDowngraded).toBe(false);
      expect(r.nextSteps).not.toContain(IMAGE_ONLY_NEXT_STEP);
    },
  );

  it("does not touch SAFE when the submission has text", () => {
    const r = mergeVerdict({ ai: ai("SAFE"), imageOnly: false });
    expect(r.verdict).toBe("SAFE");
    expect(r.signals.imageOnlyDowngraded).toBe(false);
  });

  it("never lowers an escalation: SAFE + malicious URL on image-only stays HIGH_RISK", () => {
    const r = mergeVerdict({
      ai: ai("SAFE"),
      imageOnly: true,
      urlResults: [{ url: "https://x.test", isMalicious: true, sources: ["virustotal"] }],
    });
    expect(r.verdict).toBe("HIGH_RISK");
    expect(r.signals.imageOnlyDowngraded).toBe(false);
  });

  it("does not duplicate the next step if the model already gave it", () => {
    const r = mergeVerdict({
      ai: { ...ai("SAFE"), nextSteps: [IMAGE_ONLY_NEXT_STEP] },
      imageOnly: true,
    });
    expect(r.nextSteps.filter((s) => s === IMAGE_ONLY_NEXT_STEP)).toHaveLength(1);
  });
});
