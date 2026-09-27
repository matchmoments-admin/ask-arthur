import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A parked Lane must stay parked, and a park must be a real one.
 *
 * "Parking" is this repo's established way to stop a Lane whose scheduled tick
 * does nothing but cost a slot: drop the `{ cron }` trigger, keep the
 * `{ event }` one, and record the restore condition in a comment. Four Lanes
 * were parked by an earlier sweep and three more by #1248. Nothing checked
 * that they stayed that way — re-adding a cron is a one-line edit that no
 * typecheck, test or preview would notice, and the symptom (a daily run that
 * fails or early-returns) is exactly the thing nobody looks at.
 *
 * This is the guard for that. Each entry below is a deliberate park with its
 * reason; the test asserts the file registers NO cron trigger for it.
 *
 * Comments are stripped before scanning, because every park comment quotes the
 * cron string it wants restored (`**restore by re-adding { cron: "0 4 * * *" }**`).
 * A guard that counted those would fail on a correctly-parked Lane, and the
 * obvious "fix" would be to delete the restore instruction — losing the one
 * piece of knowledge the park needs to carry.
 *
 * Verified go-red: putting `{ cron: "0 4 * * *" }` back on
 * `acnc-charity-backfill-embed` fails this test naming that id.
 *
 * To UNPARK a Lane deliberately: delete its entry here in the same commit that
 * restores the cron, and say in the commit message which restore condition was
 * met. The entry is the record that the park was a decision, not an accident.
 */

const WEB_FNS = join(process.cwd(), "app/api/inngest/functions");
const ENGINE_FNS = join(process.cwd(), "../../packages/scam-engine/src/inngest");

interface ParkedLane {
  /** Inngest function id, as registered. */
  id: string;
  file: string;
  /** What has to be true before the cron comes back. */
  restoreWhen: string;
}

const PARKED_LANES: ParkedLane[] = [
  {
    id: "acnc-charity-backfill-embed",
    file: join(ENGINE_FNS, "acnc-charity-backfill-embed.ts"),
    // Parked 2026-09-27: failed 100% of daily runs on a Voyage 429 (unpaid
    // tier, 3 RPM) while 66,745/66,864 rows were already embedded and the
    // consumer surface was dark.
    restoreWhen:
      "NEXT_PUBLIC_FF_CHARITY_CHECK is live AND Voyage is on a paid tier (or this fn's request rate fits 3 RPM)",
  },
  {
    id: "feed-items-embed",
    file: join(ENGINE_FNS, "feed-items-embed.ts"),
    // Parked 2026-09-27: 6 runs/day writing feed_items.embedding, whose only
    // reader (match_feed_items_narrative via /api/v1/intel/search) needs a B2B
    // API key — and api_keys held zero rows.
    restoreWhen: "the first B2B API key exists and narratives search is enabled for it",
  },
  {
    id: "scam-alert-push",
    file: join(ENGINE_FNS, "scam-alerts.ts"),
    restoreWhen: "push alerts launch (featureFlags.pushAlerts on in prod)",
  },
  {
    id: "enrich-vulnerabilities-cron",
    file: join(ENGINE_FNS, "enrich-vulnerability.ts"),
    restoreWhen: "vuln enrichment is wanted on a schedule again",
  },
  {
    id: "regulator-alert-push",
    file: join(WEB_FNS, "regulator-alert-push.ts"),
    restoreWhen: "regulator push alerts launch",
  },
  {
    id: "report-onward-auto-report",
    file: join(WEB_FNS, "onward-auto-report.ts"),
    restoreWhen: "auto onward reporting is switched on",
  },
];

/** Remove block and line comments so quoted restore instructions don't count. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The source segment belonging to one `createFunction` call, by its id. */
function segmentFor(src: string, id: string): string | null {
  const segments = src.split("createFunction(").slice(1);
  for (const seg of segments) {
    if (new RegExp(`id:\\s*["']${id}["']`).test(seg)) return seg;
  }
  return null;
}

describe("parked Inngest lanes", () => {
  it.each(PARKED_LANES)(
    "$id has no cron trigger (restore when: $restoreWhen)",
    ({ id, file }) => {
      const seg = segmentFor(stripComments(readFileSync(file, "utf8")), id);
      // A null segment means the id was renamed or the fn deleted — that must
      // fail loudly rather than vacuously pass, or this guard rots into scenery.
      expect(seg, `no createFunction with id "${id}" in ${file}`).not.toBeNull();
      const crons = [...seg!.matchAll(/\bcron:\s*["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      expect(
        crons,
        crons.length === 0
          ? ""
          : `${id} is listed as PARKED but registers cron ${JSON.stringify(crons)}. ` +
              `If the park is over, remove its entry from PARKED_LANES in the same commit.`,
      ).toEqual([]);
    },
  );

  it("still keeps an event trigger, so a parked lane remains invokable", () => {
    for (const { id, file } of PARKED_LANES) {
      const seg = segmentFor(stripComments(readFileSync(file, "utf8")), id)!;
      expect(
        /\bevent:\s*["'`]/.test(seg) || /\{\s*event:/.test(seg),
        `${id} has neither a cron nor an event trigger — it is unreachable, not parked`,
      ).toBe(true);
    }
  });
});
