/**
 * The badge must report what we found, not what the caller asked for.
 *
 * Before this test, every value `/api/badge` rendered came from the query
 * string — no lookup, no domain binding, no validation:
 *
 *     const grade = searchParams.get("grade") || "A+";
 *     const score = parseInt(searchParams.get("score") || "97", 10);
 *     const date  = searchParams.get("date")  || <today>;
 *
 * Verified against production before the fix:
 *
 *     ?grade=A%2B&score=100&style=pill        ->  "Ask Arthur"  "A+ · 100"
 *     ?grade=A%2B&style=cert&date=2030-01-01  ->  "A+" "ASK ARTHUR" "VERIFIED"
 *                                                 "2030-01-01"
 *
 * A VERIFIED certificate on askarthur.au, perfect grade, dated four years out,
 * asserted by whoever wrote the img tag. On a product whose whole value is
 * telling people what to trust, that is the worst thing to leave open.
 *
 * The assertions below are about the ROUTE'S OUTPUT, not its implementation —
 * a future refactor is free to change how the lookup happens, and these still
 * hold.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let siteRow: {
  latest_grade: string | null;
  latest_score: number | null;
  last_scanned_at: string | null;
} | null = null;
let siteError: unknown = null;

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: siteRow, error: siteError }),
        }),
      }),
    }),
  }),
}));

const { GET } = await import("@/app/api/badge/route");

/**
 * The text a reader actually sees, not the raw SVG.
 *
 * My first version asserted `not.toContain("100")` against the whole document
 * and failed on `stop-offset="100%"` in a gradient. Same lesson as the feed
 * smoke test: a raw-markup assertion is not an assertion about what is
 * displayed, and it fails — or passes — for reasons that have nothing to do
 * with the behaviour under test.
 */
function visibleText(svg: string): string {
  return (svg.match(/<(?:text|title)[^>]*>([^<]*)</g) ?? [])
    .map((m) => m.replace(/<[^>]*>/, "").replace(/</, ""))
    .join(" | ");
}

async function badge(query: string): Promise<string> {
  const req = new Request(`https://askarthur.au/api/badge?${query}`);
  // The route reads req.nextUrl; a plain Request exposes .url, and NextRequest
  // is constructed from it in the runtime. Emulate the shape the handler uses.
  const res = await GET(
    Object.assign(req, {
      nextUrl: new URL(req.url),
    }) as never,
  );
  return await res.text();
}

describe("/api/badge cannot be forged", () => {
  beforeEach(() => {
    siteRow = null;
    siteError = null;
  });

  it("ignores a caller-supplied grade, on an ELIGIBLE domain", async () => {
    // THE test, and the first version of it was wrong in a way worth keeping
    // a note about.
    //
    // I originally used a site whose stored grade was "F". The test passed
    // even with the forgery deliberately reinstated — because an F is below
    // ELIGIBLE_GRADES, so the route returned the neutral badge before the
    // grade was ever read. The assertion was true for the wrong reason.
    //
    // The forgery only shows on a site that IS badge-eligible and whose real
    // grade is LOWER than the one the caller asks for. That is also the case
    // an attacker cares about: taking a real B and displaying an A+.
    siteRow = { latest_grade: "B", latest_score: 71, last_scanned_at: "2026-01-01" };
    const text = visibleText(await badge("domain=example.com&grade=A%2B&score=100&style=pill"));
    expect(text).toContain("B · 71");
    expect(text).not.toContain("A+");
    expect(text).not.toContain("100");
  });

  it("ignores a caller-supplied grade on an ineligible domain too", async () => {
    // The masked case from above, kept explicitly so the neutral-badge path
    // is covered rather than accidentally relied upon.
    siteRow = { latest_grade: "F", latest_score: 12, last_scanned_at: "2026-01-01" };
    const text = visibleText(await badge("domain=example.com&grade=A%2B&score=100&style=pill"));
    expect(text).toContain("Needs improvement");
    expect(text).not.toContain("A+");
  });

  it("does not say VERIFIED for a domain we have never scanned", async () => {
    siteRow = null;
    const text = visibleText(await badge("domain=never-scanned.example&grade=A%2B&style=cert&date=2030-01-01"));
    expect(text).not.toContain("VERIFIED");
    expect(text).not.toContain("2030-01-01");
    expect(text).toContain("Not yet scanned");
  });

  it("asserts nothing when no domain is given", async () => {
    // The old default was an A+ for a bare request. That is exactly backwards:
    // absence of a subject should mean absence of a claim.
    const text = visibleText(await badge("style=cert"));
    expect(text).not.toContain("VERIFIED");
    expect(text).toContain("Not yet scanned");
  });

  it("fails closed when the lookup errors", async () => {
    // A badge is a claim. If we cannot check it, we must not make it —
    // otherwise a transient outage reintroduces the whole bug.
    siteError = { message: "connection refused" };
    const text = visibleText(await badge("domain=example.com&grade=A%2B&style=pill"));
    expect(text).not.toContain("A+");
  });

  it("will not badge a poor grade, it says so instead", async () => {
    siteRow = { latest_grade: "F", latest_score: 10, last_scanned_at: "2026-01-01" };
    const text = visibleText(await badge("domain=bad.example&style=pill"));
    expect(text).toContain("Needs improvement");
  });

  it("renders the stored grade for an eligible domain", async () => {
    siteRow = { latest_grade: "A", latest_score: 91, last_scanned_at: "2026-08-01" };
    const text = visibleText(await badge("domain=good.example&style=pill"));
    expect(text).toContain("A · 91");
  });

  it("dates the certificate from the scan, not from the caller", async () => {
    siteRow = { latest_grade: "A", latest_score: 91, last_scanned_at: "2026-08-01T09:00:00Z" };
    const text = visibleText(await badge("domain=good.example&style=cert&date=2030-01-01"));
    expect(text).toContain("2026-08-01");
    expect(text).not.toContain("2030-01-01");
  });
});
