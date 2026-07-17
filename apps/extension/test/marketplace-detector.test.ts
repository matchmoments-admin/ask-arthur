import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractSellerProfile,
  extractMarketplaceListing,
  computeTrustScore,
  detectPayIDScamPatterns,
} from "@/lib/marketplace-detector";

function loadListingFixture(): HTMLElement {
  let html = readFileSync(
    path.resolve(__dirname, "fixtures", "facebook", "marketplace-listing-2026-07.html"),
    "utf8",
  );
  // The fixture's join year is templated to "last year" so the
  // isNewAccount computation (currentYear - joinYear < 2) stays true
  // regardless of when the suite runs.
  const lastYear = String(new Date().getFullYear() - 1);
  html = html.replace("Joined Facebook in 2025", `Joined Facebook in ${lastYear}`);
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>('[role="main"]')!;
}

describe("extractSellerProfile", () => {
  it("extracts name, join year, ratings, response time, and new-account flag", () => {
    const page = loadListingFixture();
    const seller = extractSellerProfile(page);
    expect(seller.name).toBe("Sam Seller");
    expect(seller.joinDate).toBe(String(new Date().getFullYear() - 1));
    expect(seller.isNewAccount).toBe(true);
    expect(seller.ratingCount).toBe(0);
    expect(seller.responseTime).toMatch(/^Typically responds/);
    expect(seller.location).toContain("Melbourne");
  });

  it("returns nulls (not throws) on a page with no seller markers", () => {
    document.body.innerHTML = '<div role="main"><h1>Something</h1></div>';
    const seller = extractSellerProfile(
      document.querySelector<HTMLElement>('[role="main"]')!,
    );
    expect(seller.name).toBe("");
    expect(seller.joinDate).toBeNull();
    expect(seller.ratingCount).toBeNull();
    expect(seller.isNewAccount).toBe(false);
  });
});

describe("extractMarketplaceListing", () => {
  it("extracts title, price, description, location, and large images only", () => {
    const page = loadListingFixture();
    const listing = extractMarketplaceListing(page);
    expect(listing).not.toBeNull();
    expect(listing!.title).toBe("iPhone 15 Pro Max 256GB — brand new sealed");
    expect(listing!.price).toBe("$650");
    expect(listing!.description).toContain("Unwanted carrier");
    expect(listing!.location).toContain("Parramatta");
    // The 40px avatar is filtered by the >=200px threshold.
    expect(listing!.imageUrls).toHaveLength(2);
    expect(listing!.imageUrls.every((u) => !u.includes("tiny_avatar"))).toBe(true);
  });

  it("returns null when there is no heading", () => {
    document.body.innerHTML = '<div role="main"><div dir="auto">no title here</div></div>';
    expect(
      extractMarketplaceListing(document.querySelector<HTMLElement>('[role="main"]')!),
    ).toBeNull();
  });
});

describe("computeTrustScore", () => {
  it("scores the fixture's new zero-rating mismatched-location seller as warning", () => {
    const page = loadListingFixture();
    const listing = extractMarketplaceListing(page)!;
    const trust = computeTrustScore(listing.seller, listing);
    expect(trust.level).toBe("warning");
    expect(trust.score).toBeLessThan(40);
    expect(trust.factors).toContain("New account (joined recently)");
    expect(trust.factors).toContain("No seller ratings");
  });

  it("scores an established well-rated seller as trusted", () => {
    const seller = {
      name: "Old Hand",
      joinDate: "2014",
      ratingCount: 42,
      averageRating: 4.8,
      responseTime: null,
      location: "Sydney, NSW",
      isNewAccount: false,
    };
    const listing = {
      title: "Bike",
      price: "$100",
      description: "A bike",
      location: "Sydney, NSW",
      seller,
      imageUrls: [],
      listingUrl: "https://www.facebook.com/marketplace/item/1",
    };
    const trust = computeTrustScore(seller, listing);
    expect(trust.level).toBe("trusted");
    expect(trust.score).toBeGreaterThanOrEqual(70);
  });
});

describe("detectPayIDScamPatterns", () => {
  it("flags the fixture description ('sister can pick up' pattern)", () => {
    const page = loadListingFixture();
    const listing = extractMarketplaceListing(page)!;
    const result = detectPayIDScamPatterns(listing.description);
    expect(result.isScam).toBe(true);
    expect(result.patterns).toContain("Relative will collect pattern");
  });

  it.each([
    ["your payid needs a business account upgrade", "PayID upgrade/limit scam"],
    ["I'll send the payid confirmation from my gmail", "Non-bank PayID confirmation"],
    ["can you whatsapp me instead", "Moving off-platform"],
    ["I accidentally sent too much, please refund the difference", "Overpayment refund scam"],
    ["pay through the facebook payment portal", "Fake Facebook payment portal"],
  ])("flags %j as %s", (text, label) => {
    const result = detectPayIDScamPatterns(text);
    expect(result.isScam).toBe(true);
    expect(result.patterns).toContain(label);
  });

  it("does not flag ordinary buyer chat", () => {
    const result = detectPayIDScamPatterns(
      "Hi, is this still available? Could I inspect it on Saturday morning?",
    );
    expect(result.isScam).toBe(false);
    expect(result.patterns).toHaveLength(0);
  });
});
