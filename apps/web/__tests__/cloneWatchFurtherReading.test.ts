import { describe, expect, it } from "vitest";
import {
  pickFurtherReading,
  FURTHER_READING_SLUGS,
} from "@/lib/clone-watch/further-reading";

// The monthly first comment now carries an educational link chosen from the
// month's lead story. Two properties matter: it must match the theme when it
// can, and consecutive editions must never repeat when it can't.
describe("pickFurtherReading", () => {
  it("matches a super fund / bank lead to the bank story", () => {
    expect(pickFurtherReading("hesta.com.au", "2026-07-01").slug).toBe(
      "real-story-anz-bank-text-holiday-card-fraud",
    );
    expect(pickFurtherReading("westpac.com.au", "2026-07-01").slug).toBe(
      "real-story-anz-bank-text-holiday-card-fraud",
    );
  });

  it("matches retail and government leads to their own stories", () => {
    expect(pickFurtherReading("kmart.com.au", "2026-07-01").slug).toBe(
      "facebook-marketplace-scam-check-guide",
    );
    expect(pickFurtherReading("mygov.au", "2026-07-01").slug).toBe(
      "is-that-mygov-email-real-how-to-check",
    );
  });

  it("matches delivery and telco leads", () => {
    expect(pickFurtherReading("auspost.com.au", "2026-07-01").slug).toBe(
      "australia-post-delivery-scam-texts",
    );
    expect(pickFurtherReading("iinet.net.au", "2026-07-01").slug).toBe(
      "nbn-scam-calls-they-wont-disconnect-you",
    );
  });

  it("falls back to a rotation that differs month to month", () => {
    const a = pickFurtherReading("", "2026-07-01").slug;
    const b = pickFurtherReading("", "2026-08-01").slug;
    const c = pickFurtherReading(null, "2026-09-01").slug;
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it("is deterministic — a regenerated old month yields the same link", () => {
    expect(pickFurtherReading("kmart.com.au", "2026-03-01").slug).toBe(
      pickFurtherReading("kmart.com.au", "2026-03-01").slug,
    );
  });

  it("only emits slugs from the declared set (drift guard's input)", () => {
    for (const brand of ["hesta.com.au", "kmart.com.au", "", "unknownbrand.xyz"]) {
      expect(FURTHER_READING_SLUGS).toContain(pickFurtherReading(brand, "2026-07-01").slug);
    }
  });
});
