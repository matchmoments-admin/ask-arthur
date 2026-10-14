import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { allInngestFunctions } from "@/app/api/inngest/registry";
import { ALERTERS } from "@/lib/alerting/deliveryLog";
import { LANE_SHAPES } from "@/lib/laneHealth";
import {
  CLONE_WATCH_KEEP_IDS,
  CLONE_WATCH_KEPT_CRON_PATHS,
  CLONE_WATCH_ONLY_PAUSED_ALERTERS,
  inngestFunctionId,
  isAllowedInCloneWatchOnly,
  keepCloneWatchFunctions,
} from "@/lib/cloneWatchOnly";

/**
 * Clone-Watch-only mode guards (docs/ops/clone-watch-only-mode.md).
 *
 * Every list in lib/cloneWatchOnly.ts is checked against the thing it claims
 * to describe — the CONSTRUCTED Inngest functions (not a regex over source),
 * the Lane roster, and vercel.json — because a typo in a keep id would not
 * fail anything else: the mode would silently deregister a Clone Watch job on
 * the next sync and the only symptom would be a Lane going quiet.
 *
 * Go-red (2026-10-12, each run once then restored):
 *   - "shopfront-clone-urlscan-submit" → "shopfront-clone-urlscan-submt" in
 *     CLONE_WATCH_KEEP_IDS: 5 failed (keep-id, every-clone-fn, exact-set and
 *     both Lane tests).
 *   - "/api/cron/health-digest" removed from CLONE_WATCH_KEPT_CRON_PATHS: 3
 *     failed (the allow case + both vercel.json tests).
 *   - "/clone-watch" removed from the page allowlist: 2 allow cases failed.
 *   - "feedback-digest" removed from CLONE_WATCH_ONLY_PAUSED_ALERTERS: the
 *     paused-alerter test failed.
 */

const registeredIds = allInngestFunctions.map(inngestFunctionId);
const registered = new Set(registeredIds);

describe("CLONE_WATCH_KEEP_IDS", () => {
  it("reads a non-trivial registry (guards against a vacuous empty import)", () => {
    expect(registeredIds.length).toBeGreaterThan(40);
  });

  it("names only functions that are really registered", () => {
    const unknown = [...CLONE_WATCH_KEEP_IDS].filter((id) => !registered.has(id));
    expect(unknown, `keep ids with no registered function: ${unknown.join(", ")}`).toEqual([]);
  });

  it("keeps every shopfront-clone-* and clone-watch-* function", () => {
    const dropped = registeredIds.filter(
      (id) =>
        (id.startsWith("shopfront-clone-") || id.startsWith("clone-watch-")) &&
        !CLONE_WATCH_KEEP_IDS.has(id),
    );
    expect(dropped).toEqual([]);
  });

  it("keepCloneWatchFunctions returns exactly the kept set", () => {
    const kept = keepCloneWatchFunctions(allInngestFunctions).map(inngestFunctionId);
    expect(new Set(kept)).toEqual(new Set(CLONE_WATCH_KEEP_IDS));
    expect(kept.length).toBe(CLONE_WATCH_KEEP_IDS.size);
  });
});

describe("Lane roster runs only on kept functions", () => {
  it("every LANE_SHAPES Lane belongs to a kept function", () => {
    const lanes = Object.keys(LANE_SHAPES);
    expect(lanes.length).toBeGreaterThan(10);
    const orphaned = lanes.filter((lane) => !CLONE_WATCH_KEEP_IDS.has(lane.split("/")[0]!));
    expect(orphaned).toEqual([]);
  });

  it("every function scheduling via laneCrons() is kept", () => {
    const dirs = [
      join(process.cwd(), "app/api/inngest/functions"),
      join(process.cwd(), "../../packages/scam-engine/src/inngest"),
    ];
    const callers: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
        const src = readFileSync(join(dir, f), "utf8");
        for (const seg of src.split("createFunction(").slice(1)) {
          if (!seg.includes("laneCrons(")) continue;
          const id = /id:\s*"([^"]+)"/.exec(seg)?.[1];
          if (id) callers.push(id);
        }
      }
    }
    expect(callers.length).toBeGreaterThan(10);
    expect(callers.filter((id) => !CLONE_WATCH_KEEP_IDS.has(id))).toEqual([]);
  });
});

describe("isAllowedInCloneWatchOnly", () => {
  it.each([
    "/",
    "/blog",
    "/blog/some-post",
    "/blog/feed.xml",
    "/clone-watch",
    "/clone-watch/2026-09",
    "/clone-report/abc",
    "/brand-exposure",
    "/pricing",
    "/paused",
    "/about",
    "/unsubscribe",
    "/admin",
    "/admin/clone-watch",
    "/api/admin/clone-watch/triage",
    "/api/clone-watch/anything",
    "/api/clone-list-request",
    "/api/brand-stewardship/x",
    "/api/inngest",
    "/api/stripe/webhook",
    "/api/cron/health-digest",
    "/api/cron/clone-lead-digest",
    "/robots.txt",
    "/sitemap.xml",
    "/icon/128.png",
    "/.well-known/security.txt",
  ])("allows %s", (path) => {
    expect(isAllowedInCloneWatchOnly(path)).toBe(true);
  });

  it.each([
    "/api/analyze",
    "/api/extension/x",
    "/api/v1/threats/urls/lookup",
    "/api/v1/openapi.json",
    "/api/webhooks/telegram",
    "/api/inbound-scan",
    "/api/cron/weekly-email",
    "/api/cron/scraper-brake-alert",
    "/api/clone-watchx",
    "/charity-check",
    "/phone-footprint",
    "/report/example.com",
    "/app",
    "/blogger",
    "/clone-watch-fake",
  ])("blocks %s", (path) => {
    expect(isAllowedInCloneWatchOnly(path)).toBe(false);
  });
});

describe("vercel.json crons", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    crons: Array<{ path: string }>;
  };
  const cronPaths = vercel.crons.map((c) => c.path);

  it("every remaining cron route is allowed in clone-watch-only mode", () => {
    expect(cronPaths.filter((p) => !isAllowedInCloneWatchOnly(p))).toEqual([]);
  });

  it("matches CLONE_WATCH_KEPT_CRON_PATHS exactly", () => {
    expect([...cronPaths].sort()).toEqual([...CLONE_WATCH_KEPT_CRON_PATHS].sort());
  });

  it("paused alerters have no cron; every other alerter still has one", () => {
    for (const alerter of ALERTERS) {
      const scheduled = cronPaths.includes(`/api/cron/${alerter}`);
      expect(scheduled, alerter).toBe(!CLONE_WATCH_ONLY_PAUSED_ALERTERS.includes(alerter));
    }
  });
});
