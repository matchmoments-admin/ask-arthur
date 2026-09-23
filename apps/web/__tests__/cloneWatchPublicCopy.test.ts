import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brand-facing honesty guard (review 2026-09-23). Our `taken_down` means
 * Netcraft CLASSIFIED a URL malicious — not that the site went offline — and
 * the public tile read "0 min median time-to-takedown, from report to removal".
 * Public and brand-facing copy must say "blocklisted"/"classified", never
 * promise removal. Scans the surfaces a brand or the public reads.
 */
const ROOT = process.cwd();
const SURFACES = ["app/clone-watch", "app/clone-report", "emails/BrandStewardshipReport.tsx"];
const BANNED = [/from report to removal/i, /time-to-takedown/i, /now serving active phishing/i];

/** Copy, not commentary: comments may quote the old wrong claim to explain it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function files(p: string): string[] {
  const full = join(ROOT, p);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((f) => files(join(p, f)));
}

describe("clone-watch public copy", () => {
  const all = SURFACES.flatMap(files).filter((f) => /\.(tsx?|md)$/.test(f));
  it("scans the surfaces (floor)", () => expect(all.length).toBeGreaterThanOrEqual(5));
  for (const re of BANNED) {
    it(`no surface says ${re}`, () => {
      const hits = all.filter((f) => re.test(stripComments(readFileSync(f, "utf8"))));
      expect(hits).toEqual([]);
    });
  }
});
