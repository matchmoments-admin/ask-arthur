import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  extractAbnCandidates,
  isValidAbnChecksum,
  isAuHost,
  verifyShopAbn,
  verifyShopAbnDeep,
} from "../abn-extract";
import { lookupABN, type ABNLookupResult } from "../abr-lookup";
import type { ShopPageFetch } from "../fetch-shop-page";

vi.mock("../abr-lookup", () => ({ lookupABN: vi.fn() }));
const mockedLookupABN = vi.mocked(lookupABN);

// Real, checksum-valid ABNs.
const ATO_ABN = "51824753556"; // Australian Taxation Office
const AUSPOST_ABN = "28864970579"; // Australia Post

/** A successful ABR record with sensible defaults; override per test. */
function abrRecord(overrides: Partial<ABNLookupResult> = {}): ABNLookupResult {
  return {
    abn: ATO_ABN,
    entityName: "Widget Store Pty Ltd",
    entityType: "Australian Private Company",
    status: "Active",
    state: "NSW",
    postcode: "2000",
    businessNames: [],
    isAcncRegistered: false,
    dgrEndorsed: false,
    dgrItemNumber: null,
    dgrEffectiveFrom: null,
    dgrEffectiveTo: null,
    taxConcessionCharity: false,
    ...overrides,
  };
}

describe("isValidAbnChecksum", () => {
  it("accepts checksum-valid ABNs", () => {
    expect(isValidAbnChecksum(ATO_ABN)).toBe(true);
    expect(isValidAbnChecksum(AUSPOST_ABN)).toBe(true);
  });

  it("rejects 11-digit numbers that fail the checksum", () => {
    expect(isValidAbnChecksum("11111111111")).toBe(false);
    expect(isValidAbnChecksum("61400000000")).toBe(false); // phone-shaped
  });

  it("rejects non-11-digit input", () => {
    expect(isValidAbnChecksum("5182475355")).toBe(false); // 10 digits
    expect(isValidAbnChecksum("518247535560")).toBe(false); // 12 digits
    expect(isValidAbnChecksum("abcdefghijk")).toBe(false);
  });
});

describe("isAuHost", () => {
  it("recognises Australian domains", () => {
    expect(isAuHost("https://shop.com.au")).toBe(true);
    expect(isAuHost("https://store.net.au/x")).toBe(true);
    expect(isAuHost("https://sub.widgets.org.au")).toBe(true);
  });

  it("rejects non-AU and malformed hosts", () => {
    expect(isAuHost("https://shop.com")).toBe(false);
    expect(isAuHost("https://store.shop")).toBe(false);
    expect(isAuHost("not a url")).toBe(false);
  });
});

describe("extractAbnCandidates", () => {
  it("extracts a labelled ABN from page text", () => {
    const html = `<footer>ABN: 51 824 753 556 — All rights reserved</footer>`;
    expect(extractAbnCandidates(html)).toContain(ATO_ABN);
  });

  it("extracts a bare 11-digit run", () => {
    const html = `<p>Our number is 51 824 753 556 today</p>`;
    expect(extractAbnCandidates(html)).toContain(ATO_ABN);
  });

  it("ranks a labelled ABN ahead of bare digit runs", () => {
    const html = `<p>Order 12345678901</p><footer>ABN 51 824 753 556</footer>`;
    const candidates = extractAbnCandidates(html);
    expect(candidates[0]).toBe(ATO_ABN);
  });

  it("ignores digits inside <script> blocks", () => {
    const html = `<script>const t = 51824753556;</script><body>nothing</body>`;
    // 51824753556 inside a script tag is stripped before scanning.
    expect(extractAbnCandidates(html)).not.toContain(ATO_ABN);
  });

  it("returns an empty array when no 11-digit run is present", () => {
    expect(extractAbnCandidates("<p>Call 0400 123 456</p>")).toEqual([]);
  });
});

describe("verifyShopAbn", () => {
  beforeEach(() => {
    mockedLookupABN.mockReset();
  });

  it("returns not-applicable for a non-AU host without calling the register", async () => {
    const result = await verifyShopAbn(
      "<footer>ABN 51 824 753 556</footer>",
      "https://shop.com",
    );
    expect(result.status).toBe("not-applicable");
    expect(mockedLookupABN).not.toHaveBeenCalled();
  });

  it("returns unverified when the page could not be read — never a false no-abn", async () => {
    // pageError set → fetchShopPage failed; we never saw the page, so we
    // cannot assert it displays no ABN (GitHub #349, MINOR-2).
    const result = await verifyShopAbn("", "https://widgets.com.au", "timeout");
    expect(result.status).toBe("unverified");
    expect(mockedLookupABN).not.toHaveBeenCalled();
  });

  it("returns no-abn when an AU shop displays no valid ABN", async () => {
    const result = await verifyShopAbn(
      "<footer>Contact us</footer>",
      "https://widgets.com.au",
    );
    expect(result.status).toBe("no-abn");
    expect(mockedLookupABN).not.toHaveBeenCalled();
  });

  it("returns unregistered when the register reports the ABN as not-found", async () => {
    mockedLookupABN.mockResolvedValue({ ok: false, reason: "not-found" });
    const result = await verifyShopAbn(
      `<footer>ABN ${ATO_ABN}</footer>`,
      "https://widgets.com.au",
    );
    expect(result.status).toBe("unregistered");
    expect(result.abn).toBe(ATO_ABN);
  });

  it("returns unverified — not unregistered — when the register lookup fails", async () => {
    // A transient ABR outage / bad GUID / <exception> body must never be
    // reported as "ABN unregistered" (GitHub #349, F-A).
    mockedLookupABN.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const result = await verifyShopAbn(
      `<footer>ABN ${ATO_ABN}</footer>`,
      "https://widgets.com.au",
    );
    expect(result.status).toBe("unverified");
    expect(result.abn).toBe(ATO_ABN);
  });

  it("returns unregistered when the ABN record is not Active", async () => {
    mockedLookupABN.mockResolvedValue(
      abrRecord({ entityName: "Defunct Co Pty Ltd", status: "Cancelled" }),
    );
    const result = await verifyShopAbn(
      `<footer>ABN ${ATO_ABN}</footer>`,
      "https://widgets.com.au",
    );
    expect(result.status).toBe("unregistered");
  });

  it("returns verified when the registered name matches the shop brand", async () => {
    mockedLookupABN.mockResolvedValue(
      abrRecord({ entityName: "Widget Store Pty Ltd" }),
    );
    const result = await verifyShopAbn(
      `<title>Widget Store</title><footer>ABN ${ATO_ABN}</footer>`,
      "https://widgetstore.com.au",
    );
    expect(result.status).toBe("verified");
    expect(result.entityName).toBe("Widget Store Pty Ltd");
  });

  it("returns verified when a registered business name matches even though the legal name does not", async () => {
    // A sole trader's legal name is a person; the shop trades under a
    // registered business name. Matching against businessNames keeps the
    // legitimate shop `verified` instead of a false `name-mismatch`.
    mockedLookupABN.mockResolvedValue(
      abrRecord({
        entityName: "John Citizen",
        entityType: "Individual/Sole Trader",
        businessNames: ["Mega Luxury Outlet"],
      }),
    );
    const result = await verifyShopAbn(
      `<title>Mega Luxury Outlet</title><footer>ABN ${ATO_ABN}</footer>`,
      "https://megaluxuryoutlet.com.au",
    );
    expect(result.status).toBe("verified");
  });

  it("returns name-mismatch when neither the legal nor any business name matches", async () => {
    mockedLookupABN.mockResolvedValue(
      abrRecord({
        entityName: "John Citizen",
        entityType: "Individual/Sole Trader",
        businessNames: ["Citizen Lawnmowing"],
      }),
    );
    const result = await verifyShopAbn(
      `<title>Mega Luxury Outlet</title><footer>ABN ${ATO_ABN}</footer>`,
      "https://megaluxuryoutlet.com.au",
    );
    expect(result.status).toBe("name-mismatch");
  });
});

/** A successful ShopPageFetch for the verifyShopAbnDeep tests. */
function okPage(html: string, finalUrl: string): ShopPageFetch {
  return { html, finalUrl, status: 200, error: null };
}

/** A failed ShopPageFetch — fetchShopPage never throws, it returns this. */
function failedPage(error: string): ShopPageFetch {
  return { html: null, finalUrl: null, status: null, error };
}

describe("verifyShopAbnDeep", () => {
  beforeEach(() => {
    mockedLookupABN.mockReset();
  });

  it("returns the homepage result without fetching candidate pages when the homepage shows an ABN", async () => {
    mockedLookupABN.mockResolvedValue(
      abrRecord({ entityName: "Widget Store Pty Ltd" }),
    );
    const fetchPage = vi.fn(async () =>
      okPage(
        `<title>Widget Store</title><footer>ABN ${ATO_ABN}</footer>`,
        "https://widgetstore.com.au/",
      ),
    );
    const result = await verifyShopAbnDeep(
      "https://widgetstore.com.au/",
      fetchPage,
    );
    expect(result.status).toBe("verified");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("walks candidate pages and finds an ABN that is not on the homepage", async () => {
    // The dominant real-world case (#349): a legitimate AU retailer keeps
    // its ABN on an /about page, not the homepage.
    mockedLookupABN.mockResolvedValue({ ok: false, reason: "not-found" });
    const fetchPage = vi.fn(async (u: string) =>
      u.endsWith("/about")
        ? okPage(`<footer>ABN ${ATO_ABN}</footer>`, u)
        : okPage("<footer>no abn here</footer>", u),
    );
    const result = await verifyShopAbnDeep("https://widgets.com.au/", fetchPage);
    expect(result.abn).toBe(ATO_ABN);
    expect(result.status).toBe("unregistered"); // lookupABN mocked not-found
    expect(fetchPage).toHaveBeenCalledTimes(2); // homepage + /about
    // The candidate fetch receives a numeric slice of the shared budget.
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://widgets.com.au/about",
      expect.any(Number),
    );
  });

  it("returns no-abn when neither the homepage nor any candidate page shows an ABN", async () => {
    const fetchPage = vi.fn(async (u: string) =>
      okPage("<footer>contact us</footer>", u),
    );
    const result = await verifyShopAbnDeep("https://widgets.com.au/", fetchPage);
    expect(result.status).toBe("no-abn");
    expect(fetchPage).toHaveBeenCalledTimes(5); // homepage + 4 candidate pages
    expect(mockedLookupABN).not.toHaveBeenCalled();
  });

  it("never fetches candidate pages for a non-AU host", async () => {
    const fetchPage = vi.fn(async (u: string) =>
      okPage(`<footer>ABN ${ATO_ABN}</footer>`, u),
    );
    const result = await verifyShopAbnDeep("https://shop.com/", fetchPage);
    expect(result.status).toBe("not-applicable");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("returns unverified — not no-abn — when the homepage itself could not be read", async () => {
    const fetchPage = vi.fn(async () => failedPage("timeout"));
    const result = await verifyShopAbnDeep("https://widgets.com.au/", fetchPage);
    expect(result.status).toBe("unverified");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("skips a candidate page that will not load and keeps scanning", async () => {
    mockedLookupABN.mockResolvedValue({ ok: false, reason: "not-found" });
    const fetchPage = vi.fn(async (u: string) => {
      if (u.endsWith("/about")) return failedPage("http-403");
      if (u.endsWith("/about-us"))
        return okPage(`<footer>ABN ${ATO_ABN}</footer>`, u);
      return okPage("<footer>no abn</footer>", u);
    });
    const result = await verifyShopAbnDeep("https://widgets.com.au/", fetchPage);
    expect(result.abn).toBe(ATO_ABN);
    // homepage + /about (failed, skipped) + /about-us (hit)
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
