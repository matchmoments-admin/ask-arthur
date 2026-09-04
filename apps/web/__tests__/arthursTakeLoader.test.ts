/**
 * The loader's pure decisions: which takes earn a URL, and what that URL is.
 *
 * Both are testable without a database because they were deliberately split
 * out of the query. The query itself is thin and covered by the smoke test.
 */
import { describe, expect, it } from "vitest";

import {
  takeIsPageWorthy,
  TAKE_PAGE_MIN_CONFIDENCE,
  TAKE_PAGE_MIN_TELLS,
} from "@/lib/arthurs-take/loader";
import {
  feedItemHasTake,
  parseFeedItemId,
  takeSlug,
  type FeedItem,
} from "@/lib/feed";

describe("takeSlug — shareable URLs", () => {
  it("produces a readable slug a person can recognise in a chat", () => {
    expect(takeSlug(42117, "Is this a scam? Shipping payment required?")).toBe(
      "42117-this-scam-shipping-payment-required",
    );
  });

  it("drops the country tag, which carries nothing for a reader", () => {
    expect(takeSlug(1, "[US] Behold, the beg bounty scam")).toBe(
      "1-behold-the-beg-bounty-scam",
    );
  });

  it("falls back to the bare id rather than emitting a trailing dash", () => {
    expect(takeSlug(99, "!!! ???")).toBe("99");
    expect(takeSlug(99, "")).toBe("99");
  });

  it("stays bounded no matter how long the title is", () => {
    const slug = takeSlug(5, "word ".repeat(50));
    expect(slug.split("-").length).toBeLessThanOrEqual(7);
  });
});

describe("parseFeedItemId — old links keep working", () => {
  it("resolves on the leading id, whatever the suffix says", () => {
    // The whole point: a title can be corrected, or the slug regenerated, and
    // a link someone already shared or cited still resolves.
    expect(parseFeedItemId("42117-this-scam-shipping")).toBe(42117);
    expect(parseFeedItemId("42117-completely-different-words")).toBe(42117);
    expect(parseFeedItemId("42117")).toBe(42117);
  });

  it("rejects anything that is not a positive integer id", () => {
    for (const bad of ["", "abc", "-5", "0", "0-x", "x-42117", "1e5"]) {
      expect(parseFeedItemId(bad), bad).toBeNull();
    }
  });

  it("does not read an id out of the middle of a slug", () => {
    expect(parseFeedItemId("scam-42117")).toBeNull();
  });
});

describe("takeIsPageWorthy — not every take earns a URL", () => {
  const ok = { takeStatus: "ready", tells: ["a", "b"], confidence: 0.8 };

  it("admits a substantial ready take", () => {
    expect(takeIsPageWorthy(ok)).toBe(true);
  });

  it("refuses anything not ready", () => {
    // A suppressed take has no text at all; a page would be an empty shell.
    for (const status of ["suppressed", "failed", "none", null]) {
      expect(takeIsPageWorthy({ ...ok, takeStatus: status }), `${status}`).toBe(
        false,
      );
    }
  });

  it("refuses a thin take", () => {
    // Six thousand near-duplicate pages of one bullet is a search liability
    // and a worse advert for the analysis than no page at all.
    expect(takeIsPageWorthy({ ...ok, tells: ["only one"] })).toBe(false);
    expect(takeIsPageWorthy({ ...ok, tells: [] })).toBe(false);
    expect(takeIsPageWorthy({ ...ok, tells: null })).toBe(false);
  });

  it("refuses a take the classifier was not confident about", () => {
    expect(takeIsPageWorthy({ ...ok, confidence: 0.6 })).toBe(false);
    expect(takeIsPageWorthy({ ...ok, confidence: null })).toBe(false);
  });

  it("keeps the bar meaningfully above the generation floor", () => {
    // The validator already suppresses below 0.5. If the page bar sank to
    // that, the substance rule would be doing nothing.
    expect(TAKE_PAGE_MIN_CONFIDENCE).toBeGreaterThan(0.5);
    expect(TAKE_PAGE_MIN_TELLS).toBeGreaterThanOrEqual(2);
  });
});

describe("card link and page gate must agree", () => {
  // A card that links to a page which then 404s is worse than a card with no
  // link. The two checks live in different modules because FeedCard is a
  // client component and the loader is server-only, so they cannot share an
  // implementation — which is exactly why they need a test.
  const cases: { tells: string[]; confidence: number; status: string }[] = [
    { tells: ["a", "b"], confidence: 0.8, status: "ready" },
    { tells: ["a"], confidence: 0.9, status: "ready" },
    { tells: ["a", "b"], confidence: 0.5, status: "ready" },
    { tells: ["a", "b", "c"], confidence: 0.95, status: "suppressed" },
    { tells: [], confidence: 0.9, status: "ready" },
  ];

  for (const c of cases) {
    it(`agrees for ${c.status}/${c.tells.length} tells/conf ${c.confidence}`, () => {
      const cardSays = feedItemHasTake({
        reddit_post_intel: {
          take_status: c.status,
          take_tells: c.tells,
          intent_label: "phishing",
          confidence: c.confidence,
        },
      } as unknown as FeedItem);
      const pageSays = takeIsPageWorthy({
        takeStatus: c.status,
        tells: c.tells,
        confidence: c.confidence,
      });
      expect(cardSays).toBe(pageSays);
    });
  }

  it("shows no link when there is no take at all", () => {
    expect(feedItemHasTake({} as FeedItem)).toBe(false);
  });
});
