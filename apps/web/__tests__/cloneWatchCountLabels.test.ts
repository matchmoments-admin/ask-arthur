import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PER_BRAND_UNIT_EVENTS,
  perBrandUnitLabel,
  periodCountsTargetingEvents,
} from "@/lib/clone-watch/clone-cohort";

/**
 * #1262 review, D1 — from the v5 cut-over the per-brand numbers (ranking,
 * spotlight, super fund, global brands) are TARGETING EVENTS, not domains. A
 * per-brand number labelled "lookalike domains" would misstate what we counted.
 *
 * Go-red record (2026-09-27, each edit reverted after):
 *   L1 surfaces      — restore `lookalike domains · {data.periodLabel}` beside
 *                      `sp.clones` in admin/report-card/page.tsx → red (the
 *                      spotstat); restore `({row.super_fund.clones} lookalike
 *                      domains)` in clone-watch/[period]/page.tsx → red.
 *   L2 unit label    — make perBrandUnitLabel always return "lookalike domains"
 *                      → red.
 *   (L3, the caption's first-comment rule line, lives in cloneWatchCaption.test.ts.)
 */

// Every surface that prints a per-brand clone number.
const SURFACES = [
  "app/admin/report-card/page.tsx",
  "app/clone-watch/[period]/page.tsx",
  "app/clone-watch/page.tsx",
  "lib/clone-watch/clone-watch-caption.ts",
];
// Per-brand fields. "lookalike domains" may never sit beside one of these.
const PER_BRAND = /\.clones\b|top_au_brands|global_brands|super_fund\b|topAuBrands|globalBrands|superFund|\bsp\.|\blead\.n\b/;
const WINDOW = 160;

const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** Occurrences of "lookalike domains" outside comments, with their context. */
function labelled(text: string, window = WINDOW): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/lookalike\s+domains/gi)) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const line = text.slice(lineStart, text.indexOf("\n", m.index));
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    out.push(text.slice(Math.max(0, m.index - window), m.index + m[0].length + window));
  }
  return out;
}

describe("L1 — 'lookalike domains' only ever labels the total, never a per-brand number", () => {
  it.each(SURFACES)("%s", (rel) => {
    const offenders = labelled(src(rel)).filter((w) => PER_BRAND.test(w));
    expect(offenders).toEqual([]);
  });

  it("where it sits beside a number, that number is the total", () => {
    // Tight window: the number the label is printed beside.
    const withNumber = SURFACES.flatMap((rel) => labelled(src(rel), 60)).filter((w) =>
      /\{[^}"']*\b(data|row|latest|card)\.[a-z_]+/i.test(w),
    );
    expect(withNumber.length).toBeGreaterThan(0);
    for (const w of withNumber) expect(w).toMatch(/total/i);
  });
});

describe("L2 — the per-brand unit label follows the period", () => {
  it("v5 editions say events; pre-v5 editions say domains", () => {
    expect(periodCountsTargetingEvents("2026-09-01")).toBe(false);
    expect(periodCountsTargetingEvents("2026-10-01")).toBe(true);
    expect(perBrandUnitLabel("targeting_events")).toBe(PER_BRAND_UNIT_EVENTS);
    expect(perBrandUnitLabel("targeting_events")).not.toMatch(/domains/);
    expect(perBrandUnitLabel("domains")).toBe("lookalike domains");
    expect(perBrandUnitLabel(undefined)).toBe("lookalike domains"); // a pinned pre-v5 card
  });
});
