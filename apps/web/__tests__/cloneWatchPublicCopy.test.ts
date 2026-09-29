import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brand-facing honesty guard (review 2026-09-23). Our `taken_down` means
 * Netcraft CLASSIFIED a URL malicious — not that the site went offline — and
 * the public tile read "0 min median time-to-takedown, from report to removal".
 * Public and brand-facing copy must say "blocklisted"/"classified", never
 * promise removal. Scans the surfaces a brand or the public reads.
 *
 * Extended by PR-D (map #1224, 2026-09-28) with the caption's honesty rules
 * and the /hub, because the false claims it fixed had copies on surfaces this
 * guard did not read:
 *   - "We never publish which specific domains we report" — on /clone-watch
 *     (twice, beside the list of those domains) and on /hub;
 *   - reports "to the affected brand's security team" — a lane that has never
 *     fired (clone_watch_public_impact.brand_notifications_total = 0);
 *   - "~50" / "approximately 50" brands — the watchlist held 293;
 *   - "N of those we escalated" in the stewardship email — wrong denominator.
 *
 * GO-RED (each verified by restoring the old text in the named file, running
 * this file, seeing the named test fail, and restoring):
 *   - page.tsx's "We never publish which specific domains" → "no surface says
 *     /never publish which specific domains/";
 *   - hub/page.tsx's old note → the same test (hub is now scanned);
 *   - page.tsx's "approximately 50" → "no surface says /approximately \d+…/";
 *   - getAlerts' `.not("submitted_to->netcraft", …)` removed → "every listed
 *     domain was reported";
 *   - getAlerts ordering by severity first → "newest first is true".
 */
const ROOT = process.cwd();
const SURFACES = [
  "app/clone-watch",
  "app/clone-report",
  "app/hub",
  "emails/BrandStewardshipReport.tsx",
  "lib/clone-watch/public-impact.ts",
  "components/clone-watch",
  // outcome-copy.ts is NOT scanned as source: it also holds the LinkedIn
  // caption's paragraph, whose own rules and tests live in
  // cloneWatchCaption.test.ts. Its email lines are checked RENDERED, in
  // brandStewardshipEmail.test.ts ("outcome block honesty").
];
const BANNED = [
  /from report to removal/i,
  /time-to-takedown/i,
  /now serving/i,
  // PR-D additions — the caption's rules, now on every public surface.
  /never publish which specific domains/i,
  /no specific domains are published/i,
  /of those we escalated/i,
  /we took down|we removed/i,
  /one actor/i,
  /approximately \d+ (australian )?(retail|brand)|~\s?\d+ (monitored )?(australian )?brands/i,
];
/** Page-only: the brand-notification lane has never fired. */
const PAGE_BANNED = [/brand(&apos;|')s security team/i];

/** Copy, not commentary: comments may quote the old wrong claim to explain it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function files(p: string): string[] {
  const full = join(ROOT, p);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((f) => files(join(p, f)));
}

describe("clone-watch public copy", () => {
  const all = SURFACES.flatMap(files).filter((f) => /\.(tsx?|md)$/.test(f));
  it("scans the surfaces (floor)", () => expect(all.length).toBeGreaterThanOrEqual(9));
  for (const re of BANNED) {
    it(`no surface says ${re}`, () => {
      const hits = all.filter((f) => re.test(stripComments(readFileSync(f, "utf8"))));
      expect(hits).toEqual([]);
    });
  }
  for (const re of PAGE_BANNED) {
    it(`the /clone-watch page and /hub do not say ${re}`, () => {
      const pages = ["app/clone-watch/page.tsx", "app/hub/page.tsx"].map((p) => join(ROOT, p));
      const hits = pages.filter((f) => re.test(stripComments(readFileSync(f, "utf8"))));
      expect(hits).toEqual([]);
    });
  }
});

/**
 * Review of #1286.
 * GO-RED: restoring "typosquats set up to phish your customers" in the
 * dashboard's LinkedIn message fails the first test; deleting the
 * revalidatePath call from the triage route's fp branch fails the second.
 */
describe("brand-facing outreach + fp purge (review of #1286)", () => {
  it("the stewardship LinkedIn message makes no intent claim", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "app/admin/brand-stewardship/BrandStewardshipDashboard.tsx"), "utf8"),
    );
    expect(src).not.toMatch(/set up to phish/i);
    expect(src).toContain("${lookalikeDomains(n)} resembling ${brand}");
  });

  it("an operator fp purges /clone-watch at once instead of waiting out the ISR hour", () => {
    const route = readFileSync(join(ROOT, "app/api/admin/clone-watch/triage/route.ts"), "utf8");
    const fpBranch = route.slice(
      route.indexOf('} else if (parsed.status === "fp") {'),
      route.indexOf("return NextResponse.json({\n    ok: true"),
    );
    expect(fpBranch).toMatch(/revalidatePath\("\/clone-watch"\)/);
  });
});

describe("/clone-watch list — the claims the page makes are enforced by its query", () => {
  const page = readFileSync(join(ROOT, "app/clone-watch/page.tsx"), "utf8");
  const getAlerts = page.slice(page.indexOf("async function getAlerts"), page.indexOf("async function getMonitoredBrands"));
  const list = readFileSync(join(ROOT, "components/clone-watch/CloneWatchDomainList.tsx"), "utf8");

  it("every listed domain is confirmed", () => {
    expect(getAlerts).toMatch(/\.in\("triage_status", \["tp_confirmed", "tp_actioned"\]\)/);
  });

  it("every listed domain was reported (REPORTING_STATEMENT)", () => {
    expect(getAlerts).toContain(`.not("submitted_to->netcraft", "is", null)`);
  });

  it("newest first is true (the label and the order agree)", () => {
    expect(list).toMatch(/newest first/);
    const orders = [...getAlerts.matchAll(/\.order\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(orders).toEqual(["first_seen_at"]);
    expect(getAlerts).toMatch(/\.order\("first_seen_at", \{ ascending: false \}\)/);
  });

  it("the brand count is read, never typed", () => {
    expect(page).toMatch(/monitoredBrandsPhrase\(/);
    expect(stripComments(page)).not.toMatch(/\b\d{2,3}\+? (australian )?(retail|brand)/i);
  });
});
