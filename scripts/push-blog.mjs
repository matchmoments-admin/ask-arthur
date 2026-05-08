#!/usr/bin/env node
// Push a hand-authored markdown draft into the agent-fleet publish flow:
// Ghost (status=draft) → Notion row (Status=Draft, with the Ghost preview
// link) → Telegram approval keyboard. The founder taps Approve on Telegram
// and the existing handleApprovalCallback flips Ghost from draft → published
// with newsletter delivery.
//
// Usage:
//   node scripts/push-blog.mjs <slug>                    push one file
//   node scripts/push-blog.mjs <slug> --no-newsletter    publish without email
//   node scripts/push-blog.mjs <slug> --dry-run          render HTML, print, don't POST
//   node scripts/push-blog.mjs --backfill                interactive list of orphans
//
// Env:
//   TELEGRAM_WEBHOOK_SECRET (required)  — shared secret between this script
//                                         and the Worker /push-blog endpoint
//   AGENT_FLEET_URL         (optional)  — defaults to the prod Worker URL
//                                         documented in agent-fleet STATUS.md
//
// Frontmatter is optional. Smart defaults for missing fields:
//   title    = first H1 of the body
//   slug     = filename stripped of leading YYYY-MM-DD- and .md
//   excerpt  = first non-heading paragraph
//   tags     = []
//
// On success the script writes published_to_ghost_at + ghost_post_id +
// ghost_preview_url back into the file's frontmatter so re-runs are visible
// (and `git diff` shows the file was queued).

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { marked } from "marked";

const AGENT_FLEET_URL =
  process.env.AGENT_FLEET_URL?.replace(/\/$/, "") ||
  "https://agent-fleet.matchmoments.workers.dev";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.resolve(__dirname, "..", "docs", "blog");

// ── CLI parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const dryRun = flags.has("--dry-run");
const backfill = flags.has("--backfill");
const noNewsletter = flags.has("--no-newsletter");

// Secret check is enforced inside pushOne() right before the fetch call so
// `--backfill` can list orphans + `--dry-run` can render HTML without it.

// ── Main ────────────────────────────────────────────────────────────────────

if (backfill) {
  await runBackfill();
} else {
  const slug = positional[0];
  if (!slug) {
    console.error("Usage: node scripts/push-blog.mjs <slug> [--dry-run] [--no-newsletter]");
    console.error("       node scripts/push-blog.mjs --backfill");
    process.exit(2);
  }
  await pushOne(slug);
}

// ── Single-file flow ────────────────────────────────────────────────────────

async function pushOne(slug) {
  const fileSlug = slug.replace(/\.md$/, "");
  const filePath = path.join(BLOG_DIR, `${fileSlug}.md`);

  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  if (frontmatter.published_to_ghost_at) {
    console.error(
      `Already pushed at ${frontmatter.published_to_ghost_at}.\n` +
        `If you want to re-push (e.g. content edits), delete that frontmatter ` +
        `field first; otherwise update via Ghost admin.`,
    );
    process.exit(1);
  }

  const meta = deriveMeta(frontmatter, body, fileSlug);

  // marked is configured for raw markdown → HTML; we don't need the bespoke
  // admonition/mermaid handling that apps/web/lib/blogRenderer.ts adds because
  // the public site renders this post via the Ghost mirror, not the legacy
  // markdown path. (Dual-rendered posts are not a thing.)
  const renderedHtml = await marked.parse(body);
  const html = rewriteRelativeUrls(renderedHtml);

  if (dryRun) {
    console.log("─── meta ───");
    console.log(JSON.stringify(meta, null, 2));
    console.log("─── html (first 800 chars) ───");
    console.log(html.slice(0, 800));
    console.log("─── (dry run, no POST) ───");
    return;
  }

  if (!SECRET) {
    console.error(
      "TELEGRAM_WEBHOOK_SECRET is required to push (export it or run with --dry-run).",
    );
    process.exit(2);
  }

  const payload = {
    slug: meta.slug,
    title: meta.title,
    html,
    tags: meta.tags,
    excerpt: meta.excerpt,
    hero_image_url: meta.hero,
    hero_image_alt: meta.hero_alt,
    send_newsletter: !noNewsletter,
    source: "local",
  };

  const res = await fetch(`${AGENT_FLEET_URL}/push-blog`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Push failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("Pushed:");
  console.log(`  Ghost post id:  ${result.ghost_post_id}`);
  console.log(`  Ghost preview:  ${result.ghost_preview_url}`);
  console.log(`  Notion row:     ${result.notion_url}`);
  console.log(`  Approval nonce: ${result.approval_nonce}`);
  console.log("\nCheck Telegram for the Approve/Reject keyboard.");

  // Write provenance back into the source file's frontmatter so re-runs are
  // explicit and `git diff` shows what was queued.
  const updatedFrontmatter = {
    ...frontmatter,
    title: meta.title,
    excerpt: meta.excerpt,
    tags: meta.tags,
    ...(meta.hero && { hero: meta.hero }),
    ...(meta.hero_alt && { hero_alt: meta.hero_alt }),
    ...(meta.category && { category: meta.category }),
    published_to_ghost_at: new Date().toISOString(),
    ghost_post_id: result.ghost_post_id,
    ghost_preview_url: result.ghost_preview_url,
  };
  const newRaw = serializeFrontmatter(updatedFrontmatter, body);
  await writeFile(filePath, newRaw, "utf8");
  console.log(`\nFrontmatter written back to ${path.relative(process.cwd(), filePath)}`);
}

// ── Backfill flow ───────────────────────────────────────────────────────────

async function runBackfill() {
  const entries = await readdir(BLOG_DIR);
  const candidates = [];
  for (const f of entries) {
    if (!f.endsWith(".md") || f.startsWith("_") || f === "README.md") continue;
    const fp = path.join(BLOG_DIR, f);
    const raw = await readFile(fp, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    if (frontmatter.published_to_ghost_at) continue;
    const slug = f.replace(/\.md$/, "");
    const meta = deriveMeta(frontmatter, body, slug);
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    candidates.push({ slug, title: meta.title, wordCount });
  }

  if (candidates.length === 0) {
    console.log("No orphan markdown files (everything has published_to_ghost_at frontmatter).");
    return;
  }

  console.log(`${candidates.length} orphan markdown file(s) in docs/blog/:\n`);
  candidates.forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.title}  (${c.slug}, ${c.wordCount} words)`);
  });
  console.log("");

  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question(
    "Which to push? Comma-separated indexes, 'all', or 'q' to quit: ",
  )).trim();
  rl.close();

  if (!answer || answer === "q") return;

  const picks =
    answer === "all"
      ? candidates
      : answer
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length)
          .map((n) => candidates[n - 1]);

  if (picks.length === 0) {
    console.error("No valid indexes selected.");
    return;
  }

  for (const c of picks) {
    console.log(`\n── pushing ${c.slug} ──`);
    try {
      await pushOne(c.slug);
    } catch (err) {
      console.error(`Failed: ${err?.message ?? err}`);
    }
    // Pause between pushes so Telegram doesn't rate-limit the keyboard messages.
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Tolerant YAML frontmatter parser. Supports: scalar strings, scalar numbers
// (left as strings — we don't have numeric fields), arrays as inline JSON
// (`tags: [a, b]`) or YAML-style dashes (`tags:\n  - a\n  - b`). Booleans
// and nulls are not used here.
function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmText = raw.slice(4, end);
  const body = raw.slice(end + 5);

  const fm = {};
  const lines = fmText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2];

    // Inline array
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        fm[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        fm[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
      i++;
      continue;
    }

    // Block array
    if (value === "" && lines[i + 1]?.match(/^\s*-\s+/)) {
      const arr = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s*-\s+/)) {
        arr.push(lines[i].replace(/^\s*-\s+/, "").replace(/^['"]|['"]$/g, ""));
        i++;
      }
      fm[key] = arr;
      continue;
    }

    // Stripped quotes for scalars
    fm[key] = value.replace(/^['"]|['"]$/g, "");
    i++;
  }

  return { frontmatter: fm, body };
}

function serializeFrontmatter(fm, body) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "string") {
      // Quote if contains : or starts with special chars.
      const needsQuotes = /[:#@!]/.test(v) || v.startsWith(" ") || v.endsWith(" ");
      lines.push(`${k}: ${needsQuotes ? JSON.stringify(v) : v}`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n") + body.replace(/^\n+/, "");
}

function deriveMeta(fm, body, fileSlug) {
  // If filename was YYYY-MM-DD-actual-slug, strip the date prefix for the
  // canonical Ghost slug. Ghost mirrors this verbatim into Supabase so the
  // public URL becomes /blog/<actual-slug>.
  const slug = fm.slug || fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  // Title preference: explicit frontmatter → first H1 → title-cased slug.
  // Title-cased slug gives a readable (if approximate) title for legacy
  // drafts that don't lead with an H1; the founder can refine on Ghost
  // before approving.
  const title = fm.title || extractH1(body) || titleCaseSlug(slug);
  const excerpt = fm.excerpt || extractFirstParagraph(body) || title;
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  return {
    title,
    slug,
    excerpt,
    tags,
    hero: fm.hero || undefined,
    hero_alt: fm.hero_alt || undefined,
    category: fm.category || undefined,
  };
}

function extractH1(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function titleCaseSlug(slug) {
  return slug
    .split("-")
    .map((word) => {
      // Preserve all-caps tokens (acronyms like ACMA, SPF, ATO, NBN).
      if (word.length <= 4 && word.toUpperCase() === word.toLowerCase()) {
        return word;
      }
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function extractFirstParagraph(body) {
  // First non-heading, non-image paragraph; trimmed to roughly 200 chars.
  const blocks = body.split(/\n\s*\n/);
  for (const b of blocks) {
    const trimmed = b.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("![")) continue;
    if (trimmed.startsWith(">")) continue;
    if (trimmed.startsWith("---")) continue;
    // Strip markdown emphasis/links for cleaner excerpt.
    const flat = trimmed
      .replace(/[*_`]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return flat.length > 200 ? flat.slice(0, 197) + "…" : flat;
  }
  return null;
}

// Rewrite root-relative URLs in the rendered HTML to absolute askarthur.au
// URLs so they resolve in the Ghost preview and in the mirrored post.
function rewriteRelativeUrls(html) {
  return html
    .replace(/(\s(?:src|href))=["']\/(?!\/)([^"']*)["']/g, '$1="https://askarthur.au/$2"');
}
