import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  domainAgeDays,
  domainAgeBand,
  getDomainCreatedDate,
} from "../whois-cached";
import { createServiceClient } from "@askarthur/supabase/server";
import { lookupWhois } from "../whois";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("../whois", () => ({ lookupWhois: vi.fn() }));

const mockedCreate = vi.mocked(createServiceClient);
const mockedWhois = vi.mocked(lookupWhois);

// A chainable Supabase stub: every builder method returns the chain;
// maybeSingle() resolves the read result; the chain itself is thenable so
// the .update().eq() write-back resolves cleanly.
function supabaseChain(maybeSingleResult: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "not", "order", "limit", "update"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(maybeSingleResult));
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve);
  return chain;
}

const WHOIS_RESULT = {
  registrar: "GoDaddy",
  registrarAbuseEmail: "abuse@godaddy.com",
  registrantCountry: "AU",
  createdDate: "2018-01-01",
  expiresDate: "2030-01-01",
  nameServers: [],
  isPrivate: false,
  raw: null,
};

describe("domainAgeDays", () => {
  it("returns null for a null or unparseable date", () => {
    expect(domainAgeDays(null)).toBeNull();
    expect(domainAgeDays("not-a-date")).toBeNull();
  });

  it("returns a positive day count for a past date", () => {
    expect(domainAgeDays("2000-01-01")).toBeGreaterThan(9000);
  });
});

describe("domainAgeBand", () => {
  it("maps day counts to bands", () => {
    expect(domainAgeBand(null)).toBe("unknown");
    expect(domainAgeBand(10)).toBe("fresh");
    expect(domainAgeBand(29)).toBe("fresh");
    expect(domainAgeBand(30)).toBe("recent");
    expect(domainAgeBand(89)).toBe("recent");
    expect(domainAgeBand(90)).toBe("established");
    expect(domainAgeBand(5000)).toBe("established");
  });
});

describe("getDomainCreatedDate", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedWhois.mockReset();
  });

  it("returns a cache hit without calling WHOIS", async () => {
    mockedCreate.mockReturnValue(
      supabaseChain({
        data: {
          whois_created_date: "2019-05-01",
          whois_lookup_at: new Date().toISOString(),
        },
        error: null,
      }) as never,
    );
    const result = await getDomainCreatedDate("widgets.com.au");
    expect(result).toEqual({ createdDate: "2019-05-01", source: "cache" });
    expect(mockedWhois).not.toHaveBeenCalled();
  });

  it("falls through to a live lookup on a cache miss", async () => {
    mockedCreate.mockReturnValue(
      supabaseChain({ data: null, error: null }) as never,
    );
    mockedWhois.mockResolvedValue(WHOIS_RESULT);
    const result = await getDomainCreatedDate("widgets.com.au");
    expect(result).toEqual({ createdDate: "2018-01-01", source: "live" });
    expect(mockedWhois).toHaveBeenCalledWith("widgets.com.au", { priority: "interactive" });
  });

  // #1253. Go-red (2026-09-27): drop `&& !whois.deferral` from the write-back
  // guard in whois-cached.ts → `update` is called and this fails.
  it("does not write an unanswered (deferred) lookup back as a cache entry", async () => {
    const chain = supabaseChain({ data: null, error: null });
    mockedCreate.mockReturnValue(chain as never);
    mockedWhois.mockResolvedValue({
      ...WHOIS_RESULT,
      registrar: null,
      registrarAbuseEmail: null,
      registrantCountry: null,
      createdDate: null,
      expiresDate: null,
      deferral: { reason: "quota_deferred", retryAfter: "2026-10-01T00:00:00.000Z" },
    });
    const result = await getDomainCreatedDate("widgets.com.au");
    expect(result).toEqual({ createdDate: null, source: "live" });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("does a live lookup when no Supabase client is available", async () => {
    mockedCreate.mockReturnValue(null);
    mockedWhois.mockResolvedValue(WHOIS_RESULT);
    const result = await getDomainCreatedDate("widgets.com.au");
    expect(result).toEqual({ createdDate: "2018-01-01", source: "live" });
  });
});
