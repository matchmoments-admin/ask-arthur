import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_CONFIG } from "@/lib/feed";

// CI drift guard for the 2026-05-16 feed-quality recovery.
//
// The original bug: migrations v128 + v129 added 17 `inbound_*` slugs and
// v131 added `austrac` to the `feed_items_source_check` constraint, but
// no one added matching entries to apps/web/lib/feed.ts SOURCE_CONFIG.
// FeedCard's `?? SOURCE_CONFIG.reddit` fallback (since P0-fixed) silently
// labelled every unregistered source as "Reddit" with a chat-bubble icon.
//
// This test parses the LATEST migration that defines `feed_items_source_check`,
// extracts every quoted slug from the `ARRAY[...]` literal, and asserts
// SOURCE_CONFIG covers all of them. A future migration adding a slug
// without registering it in feed.ts will fail this test in CI before
// shipping to prod.
//
// The companion feedSourceConfig.test.ts hardcodes the known inbound_*
// slugs (a faster regression lock for the specific 2026-05-16 bug).
// This test catches the *class* of bug; that one catches the specific case.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = resolve(__dirname, "../../../supabase");
const MIGRATION_RE = /^migration-v(\d+).*\.sql$/;

// Matches both shapes seen across v97 / v128 / v129 / v131:
//   ADD CONSTRAINT feed_items_source_check
//     CHECK (source = ANY (ARRAY['reddit', 'user_report', ...]))
// — allows arbitrary whitespace + comment lines inside the ARRAY[...] body.
const CONSTRAINT_RE =
  /ADD\s+CONSTRAINT\s+feed_items_source_check[\s\S]*?CHECK\s*\(\s*source\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]\s*\)\s*\)/i;

// Single-quoted lowercase SQL identifier — same shape every migration uses.
const SLUG_RE = /'([a-z_][a-z0-9_]*)'/g;

function findLatestSourceCheckMigration(): { file: string; slugs: string[] } {
  const files = readdirSync(SUPABASE_DIR)
    .filter((f) => MIGRATION_RE.test(f))
    .sort((a, b) => {
      const va = Number(a.match(MIGRATION_RE)![1]);
      const vb = Number(b.match(MIGRATION_RE)![1]);
      return vb - va; // descending — highest version first
    });

  for (const file of files) {
    const content = readFileSync(resolve(SUPABASE_DIR, file), "utf8");
    const match = content.match(CONSTRAINT_RE);
    if (!match) continue;
    const slugs = Array.from(match[1].matchAll(SLUG_RE)).map((m) => m[1]);
    return { file, slugs };
  }
  throw new Error(
    "No migration found defining feed_items_source_check. " +
      "If you removed the constraint deliberately, drop this test too.",
  );
}

describe("feed_items source-check constraint vs SOURCE_CONFIG drift", () => {
  it("locates the latest constraint-defining migration", () => {
    const { file, slugs } = findLatestSourceCheckMigration();
    expect(file).toMatch(MIGRATION_RE);
    expect(slugs.length).toBeGreaterThan(5); // sanity: at least the base set
  });

  it("every slug in the latest constraint has a SOURCE_CONFIG entry", () => {
    const { file, slugs } = findLatestSourceCheckMigration();
    const missing = slugs.filter((slug) => !SOURCE_CONFIG[slug]);

    if (missing.length > 0) {
      throw new Error(
        `\n\nMigration ${file} adds slug(s) [${missing.join(", ")}] to ` +
          `feed_items_source_check, but apps/web/lib/feed.ts SOURCE_CONFIG ` +
          `has no matching entries.\n\n` +
          `Add an entry for each missing slug — without it, FeedCard renders ` +
          `the row with the raw slug as a label (the humanizeSource fallback), ` +
          `which is strictly better than the pre-2026-05-16 "everything is ` +
          `Reddit" failure mode, but still worse than a curated label.\n\n` +
          `See PR #249 (P0 feed-quality recovery) for the SOURCE_CONFIG ` +
          `shape — every regulator slug should set isRegulator: true; ` +
          `journalism / newsletter slugs should not.\n`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("parsed slug list contains only valid SQL identifiers", () => {
    // Guards against the regex over-matching prose (e.g. SQL comments
    // that contain single-quoted text would otherwise bleed into the
    // slug list).
    const { slugs } = findLatestSourceCheckMigration();
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
