import { describe, expect, it, vi } from "vitest";

import {
  __testing,
  persistAssignments,
  type Assignment,
} from "../reddit-intel-cluster";

const { parsePgVector } = __testing;

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

/**
 * The smallest fake that can express the four outcomes we care about. Each
 * table gets a scripted response per operation; unscripted operations succeed
 * with an empty result, so a test only says what it is about.
 */
function fakeSupabase(script: {
  themeInsert?: { data: Row | null; error: { code?: string } | null };
  themeSelectBySlug?: { data: Row | null };
  themeUpdateError?: { message: string } | null;
  postUpdateError?: { message: string } | null;
  alreadyLinked?: Row[];
}) {
  const calls = { inserts: 0, slugSelects: 0, updates: 0, memberships: 0 };

  const from = (table: string) => {
    if (table === "reddit_post_intel") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: script.alreadyLinked ?? [] }),
        }),
        update: () => ({
          eq: () => {
            calls.updates++;
            return Promise.resolve({ error: script.postUpdateError ?? null });
          },
        }),
      };
    }
    if (table === "reddit_intel_themes") {
      return {
        insert: () => ({
          select: () => ({
            single: () => {
              calls.inserts++;
              return Promise.resolve(
                script.themeInsert ?? { data: { id: "theme-new" }, error: null },
              );
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            single: () => {
              calls.slugSelects++;
              return Promise.resolve(script.themeSelectBySlug ?? { data: null });
            },
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: script.themeUpdateError ?? null }),
        }),
      };
    }
    // reddit_post_intel_themes
    return {
      insert: () => {
        calls.memberships++;
        return Promise.resolve({ error: null });
      },
    };
  };

  // The production type is the full SupabaseClient; the function uses four
  // methods of it. Casting here keeps the fake honest about that.
  return { client: { from } as never, calls };
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

describe("persistAssignments — a dropped post is counted, not silent", () => {
  it("seeds a theme and links the post on the happy path", async () => {
    const { client, calls } = fakeSupabase({});
    const a = seedAssignment();

    const r = await persistAssignments(client, [a]);

    expect(r.newThemeCount).toBe(1);
    expect(r.seedFailures).toBe(0);
    expect(a.themeId).toBe("theme-new");
    expect(calls.memberships).toBe(1);
  });

  it("adopts the existing theme when a retry hits the slug's unique constraint", async () => {
    // THE BUG THIS FILE WAS WRITTEN FOR. The slug is deterministic
    // (auto-<postId>) and reddit_intel_themes_slug_key is UNIQUE — a fact the
    // code's own comment denied. So a run that created the theme and then died
    // before linking the post produced 23505 on every subsequent retry, which
    // was warned and `continue`d: that post could never be clustered again.
    const { client, calls } = fakeSupabase({
      themeInsert: { data: null, error: { code: "23505" } },
      themeSelectBySlug: { data: { id: "theme-from-prior-attempt" } },
    });
    const a = seedAssignment();

    const r = await persistAssignments(client, [a]);

    expect(r.seedFailures).toBe(0);
    expect(r.newThemeCount).toBe(1);
    expect(a.themeId).toBe("theme-from-prior-attempt");
    expect(calls.slugSelects).toBe(1);
  });

  it("counts a seed failure when the theme can be neither created nor found", async () => {
    const { client } = fakeSupabase({
      themeInsert: { data: null, error: { code: "42501" } },
    });

    const r = await persistAssignments(client, [seedAssignment()]);

    expect(r.newThemeCount).toBe(0);
    expect(r.seedFailures).toBe(1);
  });

  it("counts a link failure when the post's theme_id update fails", async () => {
    const { client } = fakeSupabase({
      postUpdateError: { message: "deadlock detected" },
    });

    const r = await persistAssignments(client, [seedAssignment()]);

    // The theme was created, so newThemeCount is 1 — but the post is NOT
    // linked, and that asymmetry is exactly what the counter exists to show.
    expect(r.newThemeCount).toBe(1);
    expect(r.linkFailures).toBe(1);
  });

  it("skips posts a prior attempt already linked", async () => {
    const { client, calls } = fakeSupabase({
      alreadyLinked: [{ id: "post-1", theme_id: "theme-existing" }],
    });

    const r = await persistAssignments(client, [seedAssignment()]);

    expect(r.newThemeCount).toBe(0);
    expect(calls.inserts).toBe(0);
  });
});

describe("parsePgVector rejects rather than propagates", () => {
  it("parses a well-formed vector", () => {
    expect(parsePgVector("[1.5,2.5,3]")).toEqual([1.5, 2.5, 3]);
  });

  it("returns null for a vector that parses to NaN", () => {
    // Previously `[abc,def]` became [NaN, NaN] — length 2, so it survived the
    // caller's `.length > 0` filter. NaN compares false against everything, so
    // the post matched no theme, seeded, and wrote an all-NaN centroid that
    // pgvector rejects; the insert error was warned and skipped. The cause was
    // three steps from the symptom.
    expect(parsePgVector("[abc,def]")).toBeNull();
    expect(parsePgVector("[1,NaN,3]")).toBeNull();
  });

  it("returns null for an empty vector rather than the number zero", () => {
    // Number("") is 0, not NaN, so "[]" used to parse to [0] — a length-1
    // vector that silently fails every dimension check downstream.
    expect(parsePgVector("[]")).toBeNull();
    expect(parsePgVector(null)).toBeNull();
  });
});
