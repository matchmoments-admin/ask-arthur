import { describe, expect, it } from "vitest";

import {
  CLAUDE_MODEL_KEYS,
  getModel,
  type ClaudeModelEntry,
  type ClaudeModelKey,
} from "../anthropic";

describe("Claude model registry", () => {
  it("pairs every registered model id with pricing", () => {
    for (const key of CLAUDE_MODEL_KEYS) {
      const model = getModel(key);

      expect(model.id).toEqual(expect.any(String));
      expect(model.pricing.inputUsdPerToken).toBeGreaterThan(0);
      expect(model.pricing.outputUsdPerToken).toBeGreaterThan(0);
      expect(model.pricing.cacheWriteUsdPerToken).toBeGreaterThan(0);
      expect(model.pricing.cacheReadUsdPerToken).toBeGreaterThan(0);
    }
  });

  it("returns the expected shape for Sonnet 4.6", () => {
    expect(getModel("SONNET_4_6")).toEqual({
      id: "claude-sonnet-4-6",
      pricing: {
        inputUsdPerToken: 3 / 1_000_000,
        outputUsdPerToken: 15 / 1_000_000,
        cacheWriteUsdPerToken: 3.75 / 1_000_000,
        cacheReadUsdPerToken: 0.3 / 1_000_000,
      },
    });
  });

  it("throws for an unknown runtime key", () => {
    expect(() => getModel("SONNET_4_7" as ClaudeModelKey)).toThrow(
      /Unknown Claude model key/,
    );
  });

  it("requires pricing when a future model key is added", () => {
    type FutureRegistry = Record<
      ClaudeModelKey | "SONNET_4_7",
      ClaudeModelEntry
    >;

    const futureRegistry = {
      HAIKU_4_5: getModel("HAIKU_4_5"),
      SONNET_4_6: getModel("SONNET_4_6"),
      OPUS_4_7: getModel("OPUS_4_7"),
      // @ts-expect-error New model keys must register pricing beside the id.
      SONNET_4_7: { id: "claude-sonnet-4-7" },
    } satisfies FutureRegistry;

    expect(futureRegistry.SONNET_4_7.id).toBe("claude-sonnet-4-7");
  });
});
