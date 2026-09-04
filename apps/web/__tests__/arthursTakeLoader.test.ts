/**
 * The loader's pure decisions: which takes earn a URL, and what that URL is.
 *
 * Both are testable without a database because they were deliberately split
 * out of the query. The query itself is thin and covered by the smoke test.
 */
import { describe, expect, it } from "vitest";

import {
  feedItemHasTake,
  parseFeedItemId,
  takeIsPageWorthy,
  takeSlug,
  TAKE_PAGE_MIN_CONFIDENCE,
  TAKE_PAGE_MIN_TELLS,
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

describe("card link and page gate are one rule", () => {
  // A card that links to a page which then 404s is worse than a card with no
  // link. These were two implementations kept honest by this test; they are
  // now one, and feedItemHasTake delegates. The cases stay because they pin
  // the RULE, and they would catch a future re-divergence.
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

describe("the loader's select string", () => {
  // This is the shape of a bug that shipped: an ambiguous PostgREST embed made
  // loadTake return null for EVERY take, so the page rendered a clean "Report
  // not found" and nothing in typecheck, lint or unit tests could see it —
  // relationship resolution happens at request time, against real data.
  //
  // A unit test cannot run PostgREST. What it CAN do is refuse the specific
  // mistake: an embed of a table that reddit_post_intel reaches by more than
  // one foreign key must name the constraint.
  const AMBIGUOUS_EMBEDS = ["reddit_intel_themes"];

  it("names the constraint on every ambiguous embed", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../lib/arthurs-take/loader.ts", import.meta.url),
        "utf8",
      ),
    );
    for (const table of AMBIGUOUS_EMBEDS) {
      const bare = new RegExp(`(?<!!)\\b${table}\\(`);
      expect(
        bare.test(src),
        `${table} is embedded without naming its FK constraint — reddit_post_intel reaches it by both theme_id and the reddit_post_intel_themes join table, so PostgREST refuses the embed at runtime and the loader silently returns null`,
      ).toBe(false);
      expect(src).toContain(`${table}!`);
    }
  });
});
