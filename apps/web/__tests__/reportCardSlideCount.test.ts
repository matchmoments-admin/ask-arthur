import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * SLIDE_COUNT is declared twice — once in the page that renders the deck and
 * once in the Puppeteer export that captures it — and until now the only thing
 * keeping them equal was a comment saying "keep in sync".
 *
 * A drift is silent in the worst way: the export loops to ITS count, so a
 * lower value simply stops early and produces a PDF missing its final slides.
 * The export's blank-frame and runt-size guards cannot see this, because every
 * frame it did capture is fine. The first sign would be the published carousel.
 */
const PAGE = new URL("../app/admin/report-card/page.tsx", import.meta.url);
const EXPORT = new URL("../scripts/clone-watch-report-export.ts", import.meta.url);

function slideCountIn(url: URL): number {
  const src = readFileSync(url, "utf8");
  const m = /const SLIDE_COUNT = (\d+);/.exec(src);
  expect(m, `SLIDE_COUNT not found in ${url.pathname}`).not.toBeNull();
  return Number(m![1]);
}

describe("report-card SLIDE_COUNT stays in sync", () => {
  it("page and export agree", () => {
    expect(slideCountIn(EXPORT)).toBe(slideCountIn(PAGE));
  });

  it("the page's Slide() dispatch covers every slide up to the count", () => {
    // A count raised without a matching `case` silently renders the default
    // (the closing slide) twice, which reads as a design choice rather than a
    // bug.
    const src = readFileSync(PAGE, "utf8");
    const count = slideCountIn(PAGE);
    const cases = [...src.matchAll(/case (\d+): return <Slide/g)].map((m) =>
      Number(m[1]),
    );
    for (let n = 1; n < count; n++) {
      expect(cases, `slide ${n} has no case in Slide()`).toContain(n);
    }
  });
});
