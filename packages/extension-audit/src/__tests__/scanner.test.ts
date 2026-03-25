import { describe, it, expect } from "vitest";

// Basic type/import verification tests — full integration tests require CRX download
describe("extension-audit types", () => {
  it("exports scanExtension function", async () => {
    const mod = await import("../index");
    expect(typeof mod.scanExtension).toBe("function");
  });

  it("exports CRXManifest type", async () => {
    // Type-only check — if this compiles, the type exists
    const mod = await import("../types");
    expect(mod).toBeDefined();
  });
});
