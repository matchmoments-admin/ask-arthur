import { describe, expect, it } from "vitest";
import { buildEntityWrites } from "@/lib/clone-watch/feed-entity";

describe("buildEntityWrites", () => {
  it("writes a lowercased domain entity + an IP entity with the hosting country", () => {
    const w = buildEntityWrites("NAB-Login.shop", "203.0.113.7", "RU");
    expect(w).toEqual([
      { p_entity_type: "domain", p_normalized_value: "nab-login.shop", p_country_code: "RU" },
      { p_entity_type: "ip", p_normalized_value: "203.0.113.7", p_country_code: "RU" },
    ]);
  });

  it("omits the IP entity when there's no hosting IP", () => {
    const w = buildEntityWrites("nab-login.shop", null, null);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ p_entity_type: "domain", p_country_code: null });
  });

  it("produces nothing for an empty domain", () => {
    expect(buildEntityWrites("   ", null, null)).toEqual([]);
  });
});
