import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the SSRF-safe fetcher so the Okendo adapter runs offline against a
// controlled response shape (captured from the real api.okendo.io feed).
const fetchMock = vi.fn();
vi.mock("../fetch-review-api", () => ({
  fetchReviewApiJson: (...args: unknown[]) => fetchMock(...args),
}));

import { detectReviewApp } from "../providers/reviews/detect";
import { fetchOkendoReviews } from "../providers/reviews/okendo";
import { detectAndFetchReviews } from "../providers/reviews";

const OKENDO_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Kouvr Elite",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":748}}
</script>
</head><body>
<div data-oke-widget data-oke-reviews-product-id="shopify-9265765581049"></div>
<script>window.okendoWidgetSettings={"subscriberId":"686ec01f-11bd-4b9a-af9e-cf24566476e4"};</script>
</body></html>`;

describe("detectReviewApp", () => {
  it("detects Okendo with subscriber GUID and product id", () => {
    expect(detectReviewApp(OKENDO_HTML)).toEqual({
      app: "okendo",
      identifier: "686ec01f-11bd-4b9a-af9e-cf24566476e4",
      productId: "shopify-9265765581049",
    });
  });

  it("detects Yotpo and extracts the app key from the widget host", () => {
    const html = `<script src="https://staticw2.yotpo.com/aBc12345Key/widget.js"></script>`;
    expect(detectReviewApp(html)).toEqual({ app: "yotpo", identifier: "aBc12345Key" });
  });

  it("detects Judge.me and extracts the myshopify domain", () => {
    const html = `<div class="jdgm-widget"></div><script>var s="teststore.myshopify.com";</script>`;
    expect(detectReviewApp(html)).toEqual({
      app: "judgeme",
      identifier: "teststore.myshopify.com",
    });
  });

  it("detects Loox (with a store id)", () => {
    const html = `<div id="looxReviews"></div><script src="https://loox.io/widget/loox.js"></script><script>window.looxSettings={"storeId":"abc123xyz"};</script>`;
    expect(detectReviewApp(html)).toEqual({ app: "loox", identifier: "abc123xyz" });
  });

  it("returns null when no review app is fingerprinted", () => {
    expect(detectReviewApp("<html><body>a plain page</body></html>")).toBeNull();
  });

  it("does not let a stray app mention short-circuit real detection", () => {
    // Uses Loox (with an id), but the word 'yotpo' also appears with no key.
    // detectYotpo must return null (not an empty-id object) so Loox wins.
    const html = `<!-- yotpo mentioned here, no key -->
      <div id="looxReviews"></div>
      <script src="https://loox.io/widget/loox.js"></script>
      <script>window.looxSettings={"storeId":"abc123xyz"};</script>`;
    expect(detectReviewApp(html)?.app).toBe("loox");
  });
});

describe("fetchOkendoReviews", () => {
  beforeEach(() => fetchMock.mockReset());

  const detected = {
    app: "okendo" as const,
    identifier: "686ec01f-11bd-4b9a-af9e-cf24566476e4",
    productId: "shopify-9265765581049",
  };

  function review(rating: number, verified: boolean) {
    return {
      rating,
      title: `title ${rating}`,
      body: `body text for a ${rating} star review`,
      dateCreated: "2026-05-08T00:00:00.000Z",
      reviewer: { displayName: "A. Buyer", isVerified: verified },
    };
  }

  it("normalizes a single page into a corpus with the JSON-LD aggregate", async () => {
    fetchMock.mockResolvedValueOnce({
      data: {
        reviews: [
          review(5, true),
          review(5, true),
          review(4, true),
          review(2, false),
        ],
        nextUrl: null,
      },
      error: null,
    });

    const corpus = await fetchOkendoReviews(detected, OKENDO_HTML);
    expect("app" in corpus && corpus.app).toBe("okendo");
    if (!("app" in corpus)) throw new Error("expected a corpus");
    // Exact count/average come from JSON-LD, not the fetched sample.
    expect(corpus.totalReviews).toBe(748);
    expect(corpus.averageRating).toBe(4.8);
    expect(corpus.distribution).toEqual({
      one: 0,
      two: 1,
      three: 0,
      four: 1,
      five: 2,
    });
    expect(corpus.verifiedBuyerRatio).toBe(0.75);
    expect(corpus.reviews).toHaveLength(4);
    expect(corpus.fetchedFrom).toBe("api.okendo.io");
  });

  it("paginates via nextUrl up to the cap", async () => {
    fetchMock
      .mockResolvedValueOnce({
        data: { reviews: [review(5, true), review(5, true)], nextUrl: "/stores/x/reviews?p=2" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { reviews: [review(1, true)], nextUrl: null },
        error: null,
      });

    const corpus = await fetchOkendoReviews(detected, OKENDO_HTML);
    if (!("app" in corpus)) throw new Error("expected a corpus");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(corpus.distribution).toEqual({
      one: 1,
      two: 0,
      three: 0,
      four: 0,
      five: 2,
    });
  });

  it("skips with http-error when the first page fails", async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: "http-404" });
    expect(await fetchOkendoReviews(detected, OKENDO_HTML)).toEqual({
      ok: false,
      reason: "http-error",
    });
  });

  it("keeps a partial corpus when a later page fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        data: { reviews: [review(5, true)], nextUrl: "/stores/x/reviews?p=2" },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: "timeout" });

    const corpus = await fetchOkendoReviews(detected, OKENDO_HTML);
    if (!("app" in corpus)) throw new Error("expected a corpus");
    expect(corpus.distribution?.five).toBe(1);
  });

  it("rejects a hostile JSON-LD aggregate and falls back to safe values", async () => {
    fetchMock.mockResolvedValueOnce({
      data: { reviews: [review(5, true)], nextUrl: null },
      error: null,
    });
    const evilHtml = `<script type="application/ld+json">
      {"@type":"Product","aggregateRating":{"@type":"AggregateRating",
       "ratingValue":"10","reviewCount":999999999999}}
      </script>`;
    const corpus = await fetchOkendoReviews(detected, evilHtml);
    if (!("app" in corpus)) throw new Error("expected a corpus");
    // ratingValue 10 (>5) and count 1e12 (>100M) are clamped to null, so the
    // adapter falls back to the fetched sample — never the overflow values.
    expect(corpus.averageRating).toBe(5); // computed from the one fetched review
    expect(corpus.totalReviews).toBe(1); // fetched count, not 999999999999
  });

  it("prefers the product aggregate over a larger store-wide one", async () => {
    fetchMock.mockResolvedValueOnce({
      data: { reviews: [review(5, true)], nextUrl: null },
      error: null,
    });
    const html = `
      <script type="application/ld+json">{"@type":"Organization","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":5000}}</script>
      <script type="application/ld+json">{"@type":"Product","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":748}}</script>`;
    const corpus = await fetchOkendoReviews(detected, html);
    if (!("app" in corpus)) throw new Error("expected a corpus");
    expect(corpus.totalReviews).toBe(748); // product, not the store-wide 5000
    expect(corpus.averageRating).toBe(4.8);
  });

  it("uses the store-wide aggregate when the fetch is NOT product-scoped", async () => {
    // No productId → store-wide fetch → the small featured-product aggregate
    // must NOT win, else a truncated store-wide sample reads as a full census.
    fetchMock.mockResolvedValueOnce({
      data: { reviews: [review(5, true)], nextUrl: null },
      error: null,
    });
    const html = `
      <script type="application/ld+json">{"@type":"Organization","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":5000}}</script>
      <script type="application/ld+json">{"@type":"Product","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":748}}</script>`;
    const storeWide = {
      app: "okendo" as const,
      identifier: "686ec01f-11bd-4b9a-af9e-cf24566476e4",
    }; // no productId
    const corpus = await fetchOkendoReviews(storeWide, html);
    if (!("app" in corpus)) throw new Error("expected a corpus");
    expect(corpus.totalReviews).toBe(5000); // store-wide, not the product 748
  });
});

describe("detectAndFetchReviews", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns no-fingerprint for a page with no review app", async () => {
    expect(await detectAndFetchReviews("<html>nothing</html>")).toEqual({
      ok: false,
      reason: "no-fingerprint",
    });
  });

  it("returns unsupported-app for a detected-but-unstaged app (Yotpo)", async () => {
    const html = `<script src="https://staticw2.yotpo.com/aBc12345Key/widget.js"></script>`;
    expect(await detectAndFetchReviews(html)).toEqual({
      ok: false,
      reason: "unsupported-app",
    });
  });

  it("dispatches Okendo through to a corpus", async () => {
    fetchMock.mockResolvedValueOnce({
      data: { reviews: [{ rating: 5, body: "great", reviewer: { isVerified: true } }], nextUrl: null },
      error: null,
    });
    const result = await detectAndFetchReviews(OKENDO_HTML);
    expect("app" in result && result.app).toBe("okendo");
  });
});
