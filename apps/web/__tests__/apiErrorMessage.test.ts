import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "@/lib/api-error-message";

describe("apiErrorMessage", () => {
  it("prefers message, then error, then the fallback", () => {
    expect(apiErrorMessage({ message: "m", error: "e" })).toBe("m");
    expect(apiErrorMessage({ error: "SKILL.md too large to assess (max 1 MB)." })).toBe(
      "SKILL.md too large to assess (max 1 MB).",
    );
    expect(apiErrorMessage({})).toBe("Scan failed");
    expect(apiErrorMessage(null)).toBe("Scan failed");
    expect(apiErrorMessage({ error: { nested: true } })).toBe("Scan failed");
  });
});
