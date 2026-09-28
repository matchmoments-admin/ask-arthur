import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Fitness function for the Brand Send Gate (PR-C, 2026-09-28).
//
// Any file that SENDS via Resend while carrying Clone Watch brand data must
// call the gate (lib/clone-watch/brand-send-gate.ts). Before the gate, four
// paths each carried their own copy of the send conjunction and each copy was
// missing something — the founder outreach route had none of it while mailing
// real detections. A fifth sender added later would copy one of them again;
// this test makes it call the gate instead, or be listed below with a reason.
//
//   "sends via Resend"   — imports `resend` (the SDK) or `@/lib/resend`.
//   "Clone Watch brand data" — imports a brand-data module (getBrandCloneSample's
//     brand-outreach-pilot, the brand-stewardship / notify-brand email modules)
//     or names a brand-send source (the stewardship ledger, the notify-brand
//     batch RPCs, getBrandCloneSample).
//   "calls the gate"     — a call to createBrandSendGate( or checkBrandSend(.
//
// Go-red record (2026-09-28): replaced the gate call with an always-allow stub
// in each path in turn — "no file sends via Resend with brand data without
// calling the gate" FAILED every time, naming that file:
//   - api/admin/brand-stewardship/[id]/send/route.ts
//   - api/admin/clone-watch/batches/[batchId]/send/route.ts
//   - api/inngest/functions/clone-watch-notify-brand-prepare.ts
//   - api/admin/brand-outreach/send/route.ts
// "the known send paths are all found" and "the detector sees each shape" pin
// the walk and the matcher, so a regex that silently matches nothing cannot
// pass vacuously.
//
// PR-C review additions (2026-09-28): `shopfront_clone_alerts` and the
// clone-watch/resolve-brand import joined BRAND_DATA after
// api/clone-list-request was found mailing lookalike lists with no gate (now
// the "requester" profile). Go-red (2026-09-28): with those two entries
// removed → "the known send paths are all found", "every exemption still …
// matches" and the two new "detector sees each shape" cases FAILED (4); with
// the route's checkBrandSend( call replaced by a stub and named only in a
// comment → "no file sends … without calling the gate" FAILED naming it;
// with stripComments() bypassed → "a gate call that only appears in a comment
// does not count" FAILED.
//
// Known blind spots (not covered — a reviewer must look):
//   - wrapper senders: a file that sends through a helper (e.g. sendOnward,
//     runUrlBlocklistOnward) rather than importing `resend` is not seen;
//   - only apps/web/{app,lib,inngest} are walked — packages/ is not scanned;
//   - a dynamic `await import("resend")` does not match SENDS_VIA_RESEND;
//   - brand data reached indirectly (a helper that reads the tables for you,
//     under a name not listed here) is not seen;
//   - the comment stripper is regex-based; a gate call inside a string literal
//     would still count as gated.

const WEB = process.cwd();
const ROOTS = ["app", "lib", "inngest"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);
const EXT = /\.(ts|tsx)$/;

const SENDS_VIA_RESEND = /from\s+["'](?:resend|@\/lib\/resend)["']/;
const BRAND_DATA = [
  // modules
  /from\s+["'][^"']*brand-outreach-pilot["']/,
  /from\s+["'][^"']*brand-stewardship[^"']*["']/,
  /from\s+["'][^"']*BrandStewardship[^"']*["']/,
  /from\s+["'][^"']*CloneWatchBrandAlert["']/,
  /from\s+["'][^"']*notify-brand[^"']*["']/,
  // sources
  /\bgetBrandCloneSample\b/,
  /["']brand_stewardship_reports["']/,
  /["']load_clone_alert_batch["']/,
  /["']list_clone_alerts_unbatched_for_prepare["']/,
  // PR-C review: the lookalike table itself, and the watch-list resolver
  // (clone-list-request mailed both to a requester with no gate).
  /["']shopfront_clone_alerts["']/,
  /from\s+["'][^"']*clone-watch\/resolve-brand["']/,
];
const CALLS_GATE = /\b(?:createBrandSendGate|checkBrandSend)\s*\(/;

/** Files that match both but send nothing to a brand. Each says why. */
const EXEMPT: Record<string, string> = {
  "app/api/clone-watch/sample-report/route.ts":
    "Emails the requester (the address they typed) a [SAMPLE] CloneWatchBrandAlert rendered from fictional data (Coastline Bank) — no real detection, no brand recipient.",
  "app/api/inngest/functions/clone-watch-internal-digest.ts":
    "Internal recipient only: CLONE_WATCH_SHADOW_RECIPIENT / BRAND_STEWARDSHIP_SHADOW_RECIPIENT (our operator inbox), never a brand contact.",
  "lib/onward/url-blocklist-report.ts":
    "Onward URL-blocklist reports: clone URLs go to fixed blocklist intakes (lib/onward/destinations.ts) or a registrar / hosting abuse contact, never a brand. Gated per destination by its own flags and audited in onward_report_log; ONWARD_CANARY_RECIPIENT reroutes to our inbox.",
};

/** Strip // and /* *\/ comments so a gate call named in a comment does not
 *  count as gated. Crude (does not parse strings), which errs toward flagging:
 *  a "//" inside a string can only remove code, never add a gate call. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function needsGate(src: string): boolean {
  return SENDS_VIA_RESEND.test(src) && BRAND_DATA.some((re) => re.test(src));
}

function callsGate(src: string): boolean {
  return CALLS_GATE.test(stripComments(src));
}

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
}

function scan(): { needing: string[]; ungated: string[] } {
  const files: string[] = [];
  for (const r of ROOTS) walk(path.join(WEB, r), files);
  const needing: string[] = [];
  const ungated: string[] = [];
  for (const f of files) {
    const rel = path.relative(WEB, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    if (!needsGate(src)) continue;
    needing.push(rel);
    if (!callsGate(src) && !EXEMPT[rel]) ungated.push(rel);
  }
  return { needing, ungated };
}

describe("every Clone Watch brand sender calls the Brand Send Gate", () => {
  const { needing, ungated } = scan();

  it("no file sends via Resend with brand data without calling the gate", () => {
    expect(
      ungated,
      `These files send via Resend with Clone Watch brand data but never call ` +
        `createBrandSendGate()/checkBrandSend() (lib/clone-watch/brand-send-gate.ts). ` +
        `Route the send through a profile, or — only if nothing reaches a brand — add ` +
        `the file to EXEMPT with the reason.`,
    ).toEqual([]);
  });

  it("the known send paths are all found (the walk is not vacuous)", () => {
    for (const f of [
      "app/api/clone-list-request/route.ts",
      "app/api/admin/brand-stewardship/[id]/send/route.ts",
      "app/api/admin/clone-watch/batches/[batchId]/send/route.ts",
      "app/api/inngest/functions/clone-watch-notify-brand-prepare.ts",
      "app/api/admin/brand-outreach/send/route.ts",
    ]) {
      expect(needing).toContain(f);
    }
  });

  it("every exemption still exists and still matches (no stale entries)", () => {
    for (const f of Object.keys(EXEMPT)) expect(needing).toContain(f);
  });
});

describe("the detector sees each shape", () => {
  const RESEND = `import { Resend } from "resend";\n`;
  it.each([
    [`import { getBrandCloneSample } from "@/lib/email/brand-outreach-pilot";`],
    [`import X from "@/emails/BrandStewardshipReport";`],
    [`import Y from "@/emails/CloneWatchBrandAlert";`],
    [`await sb.from("brand_stewardship_reports").select("*");`],
    [`await sb.rpc("load_clone_alert_batch", {});`],
    [`await sb.from("shopfront_clone_alerts").select("candidate_domain");`],
    [`import { resolveWatchlistBrand } from "@/lib/clone-watch/resolve-brand";`],
  ])("Resend + %s → needs the gate", (line) => {
    expect(needsGate(RESEND + line)).toBe(true);
    expect(needsGate(`import { sendWelcomeEmail } from "@/lib/resend";\n` + line)).toBe(true);
  });

  it("Resend without brand data does not", () => {
    expect(needsGate(RESEND + `import W from "@/emails/Welcome";`)).toBe(false);
  });

  it("brand data without Resend does not", () => {
    expect(needsGate(`import { getBrandCloneSample } from "@/lib/email/brand-outreach-pilot";`)).toBe(false);
  });

  it("a gate call satisfies it; a mere import does not", () => {
    expect(callsGate(`const d = await checkBrandSend("outreach", sb, t);`)).toBe(true);
    expect(callsGate(`const g = createBrandSendGate("batch", sb);`)).toBe(true);
    expect(callsGate(`import { checkBrandSend } from "@/lib/clone-watch/brand-send-gate";`)).toBe(false);
  });

  it("a gate call that only appears in a comment does not count", () => {
    expect(callsGate(`// TODO: call checkBrandSend("outreach", sb, t) here`)).toBe(false);
    expect(callsGate(`/* createBrandSendGate("batch", sb) */ send();`)).toBe(false);
    expect(callsGate(`const u = "https://x"; // checkBrandSend(\nconst d = await checkBrandSend("x", sb, t);`)).toBe(true);
  });
});
