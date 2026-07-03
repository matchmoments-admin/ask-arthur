import { describe, expect, it } from "vitest";
import {
  canonicalRegistrar,
  rollupRegistrars,
} from "@/lib/clone-watch/registrar-canonical";

describe("canonicalRegistrar", () => {
  it("folds legal-entity spelling variants onto one canonical name", () => {
    expect(canonicalRegistrar("NAMECHEAP INC")).toBe("NameCheap");
    expect(canonicalRegistrar("NameCheap, Inc.")).toBe("NameCheap");
    expect(canonicalRegistrar("Dynadot LLC")).toBe("Dynadot");
    expect(canonicalRegistrar("Dynadot Inc")).toBe("Dynadot");
    expect(canonicalRegistrar("GoDaddy.com, LLC")).toBe("GoDaddy");
    expect(canonicalRegistrar("GMO Internet Group, Inc. d/b/a Onamae.com")).toBe(
      "GMO Internet (Onamae)",
    );
  });

  it("returns null for the Unknown / empty / null bucket", () => {
    expect(canonicalRegistrar(null)).toBeNull();
    expect(canonicalRegistrar(undefined)).toBeNull();
    expect(canonicalRegistrar("")).toBeNull();
    expect(canonicalRegistrar("Unknown")).toBeNull();
  });

  it("strips corporate suffixes from the long tail but keeps the name", () => {
    expect(canonicalRegistrar("Sav.com, LLC")).toBe("Sav.com");
    expect(canonicalRegistrar("Some Random Registrar Ltd")).toBe("Some Random Registrar");
  });
});

describe("rollupRegistrars", () => {
  it("merges variants, drops Unknown, and ranks descending", () => {
    const rows = rollupRegistrars({
      "NAMECHEAP INC": 39,
      "NameCheap, Inc.": 15,
      "Dynadot LLC": 51,
      "Dynadot Inc": 23,
      Unknown: 378,
      "": 4,
    });
    // NameCheap 54, Dynadot 74 → Dynadot first; Unknown/empty excluded.
    expect(rows).toEqual([
      { registrar: "Dynadot", clones: 74 },
      { registrar: "NameCheap", clones: 54 },
    ]);
    expect(rows.some((r) => r.registrar === "Unknown")).toBe(false);
  });

  it("accepts the array shape from buildRegistrarRollup too", () => {
    const rows = rollupRegistrars([
      { registrar: "GoDaddy.com, LLC", clones: 30 },
      { registrar: "GoDaddy", clones: 9 },
    ]);
    expect(rows).toEqual([{ registrar: "GoDaddy", clones: 39 }]);
  });
});
