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

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
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
const REPO_ROOT = path.resolve(__dirname, "..");
const BLOG_DIR = path.resolve(REPO_ROOT, "docs", "blog");
const ILLUSTRATIONS_DIR = path.resolve(
  REPO_ROOT,
  "apps",
  "web",
  "public",
  "illustrations",
);

// ── CLI parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const dryRun = flags.has("--dry-run");
const backfill = flags.has("--backfill");
const noNewsletter = flags.has("--no-newsletter");
const withIllustration = flags.has("--with-illustration");

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

  // Derive hero + stripped body in two passes:
  //   1. extractHero: leading H1 + first standalone image become the hero.
  //      Both are stripped from the body so they don't render twice on the
  //      Ghost detail page (which already shows title + feature_image as
  //      separate page elements).
  //   2. If still no hero, fall back to a sibling illustrations directory
  //      at apps/web/public/illustrations/blog/<slug>/ (the convention the
  //      illustrate Claude Code pipeline writes to). Picks the most recent
  //      .webp so iteratively-regenerated illustrations land automatically.
  const canonicalSlug =
    frontmatter.slug || fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const heroFromBody = extractHero(body);
  const bodyForRender = heroFromBody.strippedBody;
  const heroFromSiblingDir = await detectSiblingIllustration(canonicalSlug);
  const meta = deriveMeta(
    frontmatter,
    bodyForRender,
    fileSlug,
    heroFromBody,
    heroFromSiblingDir,
  );

  if (withIllustration && !meta.hero) {
    // Block the push and hand the founder a copy-pasteable illustrate
    // command. After they run + approve, the winning image lands in the
    // sibling dir and the next push-blog run picks it up automatically.
    printIllustrationGuidance(meta, body, canonicalSlug);
    process.exit(3);
  }

  if (!withIllustration && !meta.hero) {
    console.warn(
      "Warning: no hero image detected (frontmatter, body, or sibling dir).\n" +
        "Post will publish without a hero card on /blog and a flat OG preview.\n" +
        "Re-run with --with-illustration to generate one before pushing.\n",
    );
  }

  // marked is configured for raw markdown → HTML; we don't need the bespoke
  // admonition/mermaid handling that apps/web/lib/blogRenderer.ts adds because
  // the public site renders this post via the Ghost mirror, not the legacy
  // markdown path. (Dual-rendered posts are not a thing.)
  const renderedHtml = await marked.parse(bodyForRender);
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
    hero_image_url: meta.hero ? toAbsoluteUrl(meta.hero) : undefined,
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
    // Listing only — pass empty heroFromBody (we don't need to extract a
    // hero just to compute the title for display).
    const meta = deriveMeta(
      frontmatter,
      body,
      slug,
      { url: null, alt: null, h1Title: extractH1(body), strippedBody: body },
      null,
    );
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

function deriveMeta(fm, bodyForRender, fileSlug, heroFromBody, heroFromSiblingDir) {
  // If filename was YYYY-MM-DD-actual-slug, strip the date prefix for the
  // canonical Ghost slug. Ghost mirrors this verbatim into Supabase so the
  // public URL becomes /blog/<actual-slug>.
  const slug = fm.slug || fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  // Title preference: explicit frontmatter → leading H1 captured by
  // extractHero → title-cased slug. extractHero already extracted the H1
  // text before stripping, so we don't re-scan the (possibly stripped) body.
  const title =
    fm.title || heroFromBody.h1Title || extractH1(bodyForRender) || titleCaseSlug(slug);
  const excerpt = fm.excerpt || extractFirstParagraph(bodyForRender) || title;
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  // Hero precedence: explicit frontmatter > first body image > sibling dir.
  // Frontmatter wins so the founder always has a manual override.
  const hero = fm.hero || heroFromBody.url || heroFromSiblingDir?.url;
  const hero_alt =
    fm.hero_alt ||
    heroFromBody.alt ||
    heroFromSiblingDir?.alt ||
    (hero ? title : undefined);

  return {
    title,
    slug,
    excerpt,
    tags,
    hero: hero || undefined,
    hero_alt,
    category: fm.category || undefined,
  };
}

// extractHero looks at the first two markdown blocks. If block 1 is an H1
// and block 2 is a standalone image, both are pulled out as title + hero
// and stripped from the body so the post detail page doesn't render them
// twice (Ghost shows post title + feature_image as separate page elements
// already). If block 1 itself is an image, that's the hero.
//
// Returns: { url, alt, h1Title, strippedBody }. Any field can be null.
function extractHero(body) {
  const trimmed = body.replace(/^\s+/, "");
  const blocks = splitBlocks(trimmed);
  if (blocks.length === 0) {
    return { url: null, alt: null, h1Title: null, strippedBody: body };
  }

  let h1Title = null;
  let imgIdx = -1;
  let imgUrl = null;
  let imgAlt = null;

  // Block 1: H1?
  const block1 = blocks[0].trim();
  const h1Match = block1.match(/^#\s+(.+)$/);
  if (h1Match) {
    h1Title = h1Match[1].trim();
  }

  // Find first standalone-image block among the first 2-3 blocks. Standalone
  // = the entire block is just an image, possibly wrapped in a paragraph.
  // We accept block 1 (image-only post) or block 2 (after H1).
  const searchUpTo = Math.min(3, blocks.length);
  for (let i = 0; i < searchUpTo; i++) {
    const block = blocks[i].trim();
    const imgMatch = block.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (imgMatch) {
      // Don't promote if there's already a non-heading text paragraph before
      // this image (i.e. body content has started).
      let textBefore = false;
      for (let j = 0; j < i; j++) {
        const prev = blocks[j].trim();
        if (!prev) continue;
        if (prev.match(/^#{1,6}\s/)) continue; // heading
        if (prev.startsWith(">")) continue; // blockquote
        if (prev.match(/^[-*_]{3,}$/)) continue; // hr
        textBefore = true;
        break;
      }
      if (textBefore) break;
      imgIdx = i;
      imgAlt = imgMatch[1] || null;
      imgUrl = imgMatch[2];
      break;
    }
  }

  if (h1Title === null && imgIdx === -1) {
    return { url: null, alt: null, h1Title: null, strippedBody: body };
  }

  // Strip H1 (if any) and the hero image (if any) from the body. Other
  // blocks (italic subtitle, body) are preserved.
  const keep = blocks.filter((_, idx) => {
    if (idx === 0 && h1Title !== null) return false;
    if (idx === imgIdx) return false;
    return true;
  });
  const strippedBody = keep.join("\n\n").replace(/^\s+/, "");

  return { url: imgUrl, alt: imgAlt, h1Title, strippedBody };
}

// Split markdown into blocks separated by blank lines, preserving fenced
// code blocks as single blocks (so a blank line inside ``` doesn't split).
function splitBlocks(md) {
  const blocks = [];
  const lines = md.split("\n");
  let buf = [];
  let inFence = false;
  const flush = () => {
    if (buf.length === 0) return;
    const joined = buf.join("\n");
    if (joined.trim()) blocks.push(joined);
    buf = [];
  };
  for (const line of lines) {
    if (line.match(/^```/)) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

// Look for the most recent .webp under apps/web/public/illustrations/blog/<slug>/
// to use as a fallback hero. This is the convention the Claude Code
// illustrate pipeline writes to, so a fresh illustrate run "just works"
// without a manual frontmatter edit.
async function detectSiblingIllustration(slug) {
  const dir = path.join(ILLUSTRATIONS_DIR, "blog", slug);
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const webps = files.filter((f) => f.endsWith(".webp"));
  if (webps.length === 0) return null;

  // Pick the most recent by mtime so iterative regenerations win over
  // earlier drafts. Naming conventions vary (hero-v1.webp, post-name.webp,
  // 01-foo.webp) so we don't try to pattern-match a "hero" filename.
  const stats = await Promise.all(
    webps.map(async (f) => ({
      name: f,
      mtime: (await stat(path.join(dir, f))).mtimeMs,
    })),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  const winner = stats[0].name;
  return {
    url: `/illustrations/blog/${slug}/${winner}`,
    alt: null,
  };
}

// Print copy-pasteable illustrate guidance when --with-illustration is set
// and no hero was found. We don't subprocess-call `claude` ourselves —
// Claude Code is interactive and the brief is a creative input the founder
// will refine; just hand them the right command.
function printIllustrationGuidance(meta, body, slug) {
  const briefSubject = deriveBriefSubject(meta.title, body);
  const cmd = `claude "illustrate: ${briefSubject}, ask-arthur warm editorial, 4:3" --telegram`;

  console.error(
    `No hero image detected in frontmatter, body, or apps/web/public/illustrations/blog/${slug}/.\n\n` +
      `Run this in another terminal to generate one (with Telegram approval keyboard):\n\n` +
      `  ${cmd}\n\n` +
      `Or without the Telegram round-trip (winner committed locally only):\n\n` +
      `  claude "illustrate: ${briefSubject}, ask-arthur warm editorial, 4:3"\n\n` +
      `When the winner lands at apps/web/public/illustrations/blog/${slug}/<name>.webp,\n` +
      `re-run pnpm push-blog ${slug} and the sibling-dir auto-detect will pick it up.\n` +
      `(Or add hero: /illustrations/... to the markdown frontmatter manually.)\n`,
  );
}

function deriveBriefSubject(title, body) {
  // Take the title and the first ~120 chars of the first paragraph as the
  // creative input. Cut at a word boundary so the brief doesn't end
  // mid-word ("...a pa"). The founder will edit before running; we just
  // need a non-trivial seed.
  const firstPara = extractFirstParagraph(body) || "";
  let seed = firstPara.slice(0, 120).replace(/[":\\]/g, "");
  const lastSpace = seed.lastIndexOf(" ");
  if (lastSpace > 60) seed = seed.slice(0, lastSpace);
  return seed ? `${title} — ${seed}` : title;
}

function toAbsoluteUrl(url) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `https://askarthur.au${url}`;
  return `https://askarthur.au/${url}`;
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
