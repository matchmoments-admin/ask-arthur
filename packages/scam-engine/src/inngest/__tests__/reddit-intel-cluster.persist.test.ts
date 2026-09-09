import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  persistAssignments,
  type Assignment,
  type PersistClient,
  type PersistTables,
} from "../reddit-intel-cluster";
import type { BudgetClock } from "../step-budget";

vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * WHAT THIS FILE IS FOR.
 *
 * Until this file existed, the only test over clustering was assign.test.ts,
 * which imports the pure matcher and nothing else. You could have deleted the
 * entire persist step and every test would still have passed — while four
 * separate `continue` paths silently dropped posts on the floor. Measured in
 * prod 2026-09-07: 1,662 posts embedded and unclustered, with no signal
 * distinguishing "nothing to do" from "the same rows failing every run".
 *
 * These tests drive the failure paths, which is only possible because
 * persistAssignments now takes its client rather than reaching for one.
 */

type Row = Record<string, unknown>;

// persistAssignments depends on the budget's INTERFACE, not its constructor,
// so the already-expired path needs no fake clock — and no way to invent an
// origin of its own, which was the defect (see step-budget.ts).
const ample: BudgetClock = { expired: () => false, remainingMs: () => 60_000 };
const spent: BudgetClock = { expired: () => true, remainingMs: () => 0 };

/**
 * The Write Outcome invariant: attempted − written − failed = posts never
 * reached, non-zero only when the budget stopped the run. Go-red: return
 * `failed: seedFailures` alone → the link-failure case reads 2 − 0 − 0 = 2
 * "never reached" on a run that reached everything.
 */
function expectOutcome(
  r: {
    attempted: number;
    written: number;
    failed: number;
    deadlineHit: boolean;
  },
  expected: {
    attempted: number;
    written: number;
    failed: number;
    notReached?: number;
  },
) {
  expect({
    attempted: r.attempted,
    written: r.written,
    failed: r.failed,
  }).toEqual({
    attempted: expected.attempted,
    written: expected.written,
    failed: expected.failed,
  });
  const notReached = r.attempted - r.written - r.failed;
  expect(notReached).toBe(expected.notReached ?? 0);
  if (notReached > 0) expect(r.deadlineHit).toBe(true);
}

/**
 * The smallest fake that can express the outcomes we care about.
 *
 * It models the SET-BASED call shapes persistAssignments uses since the write
 * path was batched: a bulk upsert of seed themes, a select-by-slug that
 * resolves ids for both new and pre-existing rows, per-theme updates, a
 * grouped post link, and one bulk membership upsert. Unscripted operations
 * succeed, so each test only says what it is about.
 *
 * TYPED AGAINST THE SEAM, not cast. This used to be `{ from } as never` — the
 * type system switched off at the one seam these tests exercise, and a string
 * table name the fake did not model fell through to the membership branch and
 * answered for it silently. `PersistTables` is a per-table lookup, so a table
 * or method the function calls and this fake lacks is a compile error here,
 * and a fourth table is a compile error in the function.
 */
function fakeSupabase(script: {
  /** slug -> id, as the select-by-slug would find it. Defaults to resolving. */
  resolveSlugs?: "all" | "none";
  themeUpdateError?: { message: string } | null;
  postUpdateError?: { message: string } | null;
  alreadyLinked?: Row[];
}) {
  const calls = {
    seedUpsertRows: 0,
    slugSelects: 0,
    themeUpdates: 0,
    linkUpdates: 0,
    linkedPostIds: [] as string[],
    membershipRows: 0,
  };
  let lastSlugs: string[] = [];

  const tables: PersistTables = {
    reddit_post_intel: {
      select: () => ({
        in: () =>
          Promise.resolve({ data: script.alreadyLinked ?? [], error: null }),
      }),
      update: () => ({
        in: (_col, ids) => {
          calls.linkUpdates++;
          if (!script.postUpdateError) calls.linkedPostIds.push(...ids);
          return Promise.resolve({ error: script.postUpdateError ?? null });
        },
      }),
    },
    reddit_intel_themes: {
      upsert: (rows) => {
        calls.seedUpsertRows += rows.length;
        lastSlugs = rows.map((r) => r["slug"] as string);
        return Promise.resolve({ error: null });
      },
      select: () => ({
        in: (_col, slugs) => {
          calls.slugSelects++;
          if (script.resolveSlugs === "none") {
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({
            data: slugs.map((slug) => ({ id: `theme-for-${slug}`, slug })),
            error: null,
          });
        },
      }),
      update: () => ({
        eq: () => {
          calls.themeUpdates++;
          return Promise.resolve({ error: script.themeUpdateError ?? null });
        },
      }),
    },
    reddit_post_intel_themes: {
      upsert: (rows) => {
        calls.membershipRows += rows.length;
        return Promise.resolve({ error: null });
      },
    },
  };

  const client: PersistClient = {
    from: (table) => tables[table],
  };

  return { client, calls, slugs: () => lastSlugs };
}

function seedAssignment(postId = "post-1"): Assignment {
  return {
    postId,
    themeId: "",
    similarity: 1,
    newCentroid: [0.1, 0.2],
    newMemberCount: 1,
    isNewTheme: true,
    embeddingModelVersion: "voyage-3.5",
  };
}

function joinAssignment(postId: string, themeId: string): Assignment {
  return {
    postId,
    themeId,
    similarity: 0.8,
    newCentroid: [0.3, 0.4],
    newMemberCount: 7,
    isNewTheme: false,
    embeddingModelVersion: "voyage-3.5",
  };
}

describe("persistAssignments — a dropped post is counted, not silent", () => {
  it("seeds a theme and links the post on the happy path", async () => {
    const { client, calls } = fakeSupabase({});

    const r = await persistAssignments(client, [seedAssignment()], ample);

    expect(r.newThemeCount).toBe(1);
    expect(r.seedFailures).toBe(0);
    expect(calls.linkedPostIds).toEqual(["post-1"]);
    expect(calls.membershipRows).toBe(1);
    expectOutcome(r, { attempted: 1, written: 1, failed: 0 });
  });

  it("adopts a theme a prior attempt already created", async () => {
    // THE BUG THIS FILE WAS WRITTEN FOR. The slug is deterministic
    // (auto-<postId>) and reddit_intel_themes_slug_key is UNIQUE — a fact the
    // code's own comment once denied. A run that created the theme then died
    // before linking the post used to produce 23505 on every retry, warned and
    // skipped, so the post could never be clustered again.
    //
    // Batched, adoption needs no special case: the upsert is ON CONFLICT DO
    // NOTHING and the select-by-slug then resolves ids for pre-existing rows
    // exactly as it does for new ones. This asserts the post still gets linked.
    const { client, calls } = fakeSupabase({ resolveSlugs: "all" });

    const r = await persistAssignments(
      client,
      [seedAssignment("post-9")],
      ample,
    );

    expect(r.seedFailures).toBe(0);
    expect(calls.linkedPostIds).toEqual(["post-9"]);
  });

  it("never overwrites an existing theme row", async () => {
    // A plain upsert would reset title/member_count/first_seen_at, and by the
    // time a retry lands the theme may have grown and been named. Resetting a
    // named 50-member theme to "Pending naming"/1 is worse than the orphan.
    const src = readFileSync(
      new URL("../reddit-intel-cluster.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("ignoreDuplicates: true");
  });

  it("counts a seed failure when the theme is neither created nor found", async () => {
    const { client } = fakeSupabase({ resolveSlugs: "none" });

    const r = await persistAssignments(client, [seedAssignment()], ample);

    expect(r.newThemeCount).toBe(0);
    expect(r.seedFailures).toBe(1);
  });

  it("counts link failures per post when the theme_id update fails", async () => {
    const { client } = fakeSupabase({
      postUpdateError: { message: "deadlock detected" },
    });

    const r = await persistAssignments(
      client,
      [seedAssignment("a"), seedAssignment("b")],
      ample,
    );

    // Themes were created, posts were not linked — the asymmetry the counters
    // exist to show.
    expect(r.newThemeCount).toBe(2);
    expect(r.linkFailures).toBe(2);
    expectOutcome(r, { attempted: 2, written: 0, failed: 2 });
  });

  it("counts join failures per post when a theme's centroid update fails", async () => {
    // The three failure counters are documented as POSTS. This one was
    // incremented once per THEME, so forty posts absorbed by a theme whose
    // update failed read as a single dropped post in the run summary — the
    // partial run looked like a quiet one. Go-red: `joinFailures++` → 1.
    const { client } = fakeSupabase({
      themeUpdateError: { message: "deadlock detected" },
    });
    const joins = Array.from({ length: 40 }, (_, i) =>
      joinAssignment(`p${i}`, "theme-hot"),
    );

    const r = await persistAssignments(client, joins, ample);

    expect(r.joinFailures).toBe(40);
    expect(r.joinedThemeCount).toBe(0);
    expect(r.linkFailures).toBe(0);
    expectOutcome(r, { attempted: 40, written: 0, failed: 40 });
  });

  it("skips posts a prior attempt already linked", async () => {
    const { client, calls } = fakeSupabase({
      alreadyLinked: [{ id: "post-1", theme_id: "theme-existing" }],
    });

    const r = await persistAssignments(client, [seedAssignment()], ample);

    expect(r.newThemeCount).toBe(0);
    expect(calls.seedUpsertRows).toBe(0);
    // Already linked is not attempted — the idempotency skip is not a write.
    expectOutcome(r, { attempted: 0, written: 0, failed: 0 });
  });

  it("collapses many posts joining one theme into a single update", async () => {
    // The reason this rewrite exists. Round trips must scale with distinct
    // THEMES, not with posts: the step holds a concurrency slot for its whole
    // duration and the account runs on a 5-slot pool.
    const { client, calls } = fakeSupabase({});
    const joins = Array.from({ length: 50 }, (_, i) =>
      joinAssignment(`p${i}`, "theme-hot"),
    );

    const r = await persistAssignments(client, joins, ample);

    expect(r.joinedThemeCount).toBe(1);
    expect(calls.themeUpdates).toBe(1); // not 50
    expect(calls.linkUpdates).toBe(1); // not 50
    expect(calls.linkedPostIds).toHaveLength(50);
    expect(calls.membershipRows).toBe(50); // one bulk upsert
  });

  it("does not mutate the caller's assignments", async () => {
    // assignPostsToThemes has an explicit no-mutation test; this used to write
    // `a.themeId = created.id` back into the caller's array without saying so.
    const { client } = fakeSupabase({});
    const a = seedAssignment();

    await persistAssignments(client, [a], ample);

    expect(a.themeId).toBe("");
  });
});

/**
 * The write phase must stop before Vercel kills it.
 *
 * The Inngest route declares `maxDuration = 300`. Exceeding it is not a slow
 * run: Vercel kills the request and Inngest reports "HTTP 504 before the SDK
 * responded, no step output was produced". That happened in production on
 * 2026-09-07 — at the then-current 0.87s/post a 500-post batch needed ~435s.
 *
 * Since #1117 the load, match and write are ONE step, so a timeout loses the
 * whole batch AND the retry redoes identical work and times out identically.
 * A loop, not a degradation. Stopping early converts that into partial
 * progress, which the self-healing worklist finishes on the next run.
 *
 * THE ORIGIN DEFECT, as a behaviour. Until #1130 this function defaulted its
 * own deadline to `Date.now() + 240 s` at ITS entry — after cluster-batch had
 * already loaded 500 posts and 500 centroids and run the matcher. A step that
 * arrived here with its budget already spent still got a fresh 240 s. Now the
 * budget is the step's, and a spent one writes nothing.
 */
describe("persistAssignments respects the step's wall-clock budget", () => {
  it("writes nothing when the step's budget is already spent at entry", async () => {
    const { client, calls } = fakeSupabase({});
    const joins = Array.from({ length: 20 }, (_, i) =>
      joinAssignment(`p${i}`, `theme-${i}`),
    );

    const r = await persistAssignments(client, joins, spent);

    expect(r.deadlineHit).toBe(true);
    expect(r.joinedThemeCount).toBe(0);
    expect(calls.themeUpdates).toBe(0);
    // Twenty posts, none written, none failed: all twenty "never reached".
    expectOutcome(r, { attempted: 20, written: 0, failed: 0, notReached: 20 });
    // Nothing was linked, so nothing is claimed as done — the rows keep
    // theme_id NULL and the next run selects them again.
    expect(calls.linkedPostIds).toEqual([]);
  });

  it("does not flag a deadline when there is time", async () => {
    const { client, calls } = fakeSupabase({});
    const joins = Array.from({ length: 5 }, (_, i) =>
      joinAssignment(`p${i}`, `theme-${i}`),
    );

    const r = await persistAssignments(client, joins, ample);

    expect(r.deadlineHit).toBe(false);
    expect(r.joinedThemeCount).toBe(5);
    expect(calls.themeUpdates).toBe(5);
  });

  it("reports how much budget was left, so a near-miss is visible", async () => {
    const { client } = fakeSupabase({});

    const r = await persistAssignments(client, [seedAssignment()], ample);

    expect(r.budgetRemainingMs).toBe(60_000);
  });
});
