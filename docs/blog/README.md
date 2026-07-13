# Blog drafts — `docs/blog/`

This is the source folder for **founder-authored** long-form blog drafts. The
local `~/.claude/skills/blog` skill writes new drafts here. Files in this
folder are **markdown source**, not the published version — the public
canonical is rendered from the Supabase `blog_posts` table, which is
populated by Ghost via the webhook at `/api/blog/ghost-webhook`.

To publish a draft, push it through the agent-fleet flow:

```bash
pnpm push-blog <slug>                      # one file, default newsletter on
pnpm push-blog <slug> --no-newsletter      # publish without sending the email
pnpm push-blog <slug> --dry-run            # render HTML and print, no POST
pnpm push-blog <slug> --with-illustration  # block + print illustrate command if no hero
pnpm push-blog --backfill                  # interactive picker for orphans
```

What happens:

1. The script reads `docs/blog/<slug>.md`, parses optional YAML frontmatter,
   renders markdown → HTML, and rewrites root-relative `/illustrations/...`
   image URLs to absolute `https://askarthur.au/...` so they resolve in the
   Ghost staging preview and in the mirrored post.
2. POSTs to the agent-fleet Worker, which:
   - Creates a Ghost post with `status=draft`.
   - Adds a row to the Notion **Blog Drafts** DB (Status=Draft, with the
     Ghost preview link).
   - Sends a Telegram approval message with the preview URL.
3. You review the styled draft on Ghost, then tap ✅ Approve in Telegram.
   The Worker's existing approval callback flips Ghost from draft → published
   with newsletter delivery and writes Status=Published + Published URL into
   Notion.
4. Ghost emits a `post.published` webhook to safeverify, which mirrors the
   row into Supabase `blog_posts`. The post is then live at
   `https://askarthur.au/blog/<slug>`.

## Callouts survive Ghost

`> [!TIP]` / `[!WARNING]` / `[!DANGER]` markers render as styled callout
boxes on askarthur.au. For markdown-native posts the blog renderer handles
this directly. For Ghost-authored or Ghost-edited posts (whose editor strips
classed HTML), keep the literal `[!TYPE]` marker as the first text of a
blockquote — the Ghost mirror (`ghost-sync.ts` → `restoreCalloutMarkup`)
rebuilds the styled markup when the post syncs into `blog_posts`. This means
you can type `[!WARNING]` in a Ghost blockquote and get the styled box on
the public site.

The **Ghost-hosted surface** (blog.askarthur.au previews + newsletter
click-throughs) gets the same look via Ghost admin → Settings → Code
injection → Site header: a small CSS+JS snippet that upgrades
`[!TYPE]`-marker blockquotes client-side (pasted 2026-07-13; integration
API keys can't write settings, so it's maintained by hand in Ghost). The
snippet's style values are copied from `apps/web/app/globals.css`
`.blog-content .callout` — **if those styles change, update the Ghost
injection to match.** Icons hotload from
`https://askarthur.au/illustrations/callout-*.webp`.

## Formatting the blog CSS supports

All post styling is centralised in **one** place — `apps/web/app/globals.css`
`.blog-content` — and is applied to **every** post (markdown-native and
Ghost-mirrored alike) via `app/blog/[slug]/page.tsx`. There is no per-post CSS.
Author in plain markdown and let that shared stylesheet own the look:

- **Lists** — `-` for bullets, `1.` for numbered. They render with proper
  markers (teal discs / navy numbers / nested circles). Start each item with a
  bold lead-in — `**Term** — explanation` — for scannability. Tailwind v4
  Preflight strips list markers globally; `.blog-content` restores them, so
  **never** hand-fake a list with dashes inside a paragraph.
- **Section breaks** — a `---` horizontal rule renders as a centred `· · ·`
  divider. Use it between major sections.
- **Callouts** — `[!TIP]` / `[!WARNING]` / `[!DANGER]` / `[!NOTE]` (see below).
- **Spacing** — do NOT hand-space with extra blank lines. The stylesheet owns
  vertical rhythm via a flow-margin (`> * + *`) rule; adding a
  `.blog-content p { margin: … }` rule would silently defeat it (its
  specificity beats the flow rule — this exact bug cramped paragraphs under
  lists, fixed 2026-07-14).

The automated **monthly-intel-blog** generator encodes these same rules in its
prompt (`apps/web/lib/monthly-intel-blog.ts` → FORMATTING RULES) and its
`VALID_CATEGORIES` must match the live `blog_categories` slugs — keep the two in
sync when categories change. The personal `~/.claude/skills/blog` skill is the
known-broken flat-layout one (see the user global CLAUDE.md) and is not the
source of truth for formatting.

## External "Further reading" links

Published posts can carry curated external related-article links, rendered as
a text-card "Further reading" section at the bottom of `/blog/<slug>`. These
live in the Supabase `blog_external_links` table (v227), **not** in the
markdown, and are managed per-post via `/admin/blog`.

Curation policy (public version at `/blog/editorial-policy`):

- Priority to government (.gov.au), regulators, non-profits (IDCARE),
  academic and independent journalistic sources. Commercial content only on
  editorial merit, case-by-case — never solely because of an outreach email.
- Every link defaults to `rel="nofollow"` (we link for readers, not
  rankings; outbound links are not a Google ranking factor in either
  direction). `sponsored` is reserved for any future paid placement.
- `origin` (`editorial` / `outreach` / `partnership`) records how the link
  arrived — the audit trail for the policy.
- Text cards + favicon only. No third-party thumbnails: hotlinking is
  unreliable and legally grey in AU, and chumbox-style image grids read as
  Taboola.

## Frontmatter (optional)

Smart defaults:

| Field      | Default                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `title`    | First `# H1` of the body, else title-cased slug                                                                                |
| `slug`     | Filename with `.md` and any leading `YYYY-MM-DD-` removed                                                                      |
| `excerpt`  | First non-heading paragraph, trimmed to ~200 chars                                                                             |
| `tags`     | `[]`                                                                                                                           |
| `hero`     | First standalone image in the body (after optional H1), else newest `.webp` under `apps/web/public/illustrations/blog/<slug>/` |
| `hero_alt` | The `![alt](...)` text from the auto-detected image, else the title                                                            |
| `category` | None                                                                                                                           |

### Hero detection

The script auto-promotes a hero image to Ghost's `feature_image` (which
drives the post's hero card on `/blog`, the OG image, and the safeverify
mirror's `hero_image_url`). Detection precedence:

1. **`hero` in frontmatter** — explicit override always wins.
2. **First standalone image in the body** — must appear in the first 1-3
   blocks (i.e. before any body paragraph). When detected, both the
   leading H1 _and_ this image are stripped from the rendered HTML so they
   don't render twice (Ghost shows post title and feature_image as
   separate page elements already).
3. **`apps/web/public/illustrations/blog/<slug>/*.webp`** — most-recent
   `.webp` under that directory. This is the convention the Claude Code
   `illustrate` pipeline writes to, so a fresh illustrate run becomes the
   hero on the next push without a manual frontmatter edit.

If none match, the post publishes with no hero card. Use
`--with-illustration` to force a hero before pushing.

To override, add YAML at the top of the file:

```markdown
---
title: How to Spot ATO Scam Calls and Texts
excerpt: Three quick checks before you call anyone back.
tags: [scam-explainer, government]
hero: /illustrations/blog-ato-hero-v1.webp
hero_alt: Phone screen showing a fake ATO text message
category: scam-explainer
---

# How to Spot ATO Scam Calls and Texts

…body…
```

## After a successful push

The script writes provenance back into the file's frontmatter:

```yaml
published_to_ghost_at: "2026-05-09T01:23:45.000Z"
ghost_post_id: 65e3a1...
ghost_preview_url: https://blog.askarthur.au/p/<uuid>/
```

This makes `git diff` show which files have been queued, and prevents the
`--backfill` mode from re-prompting an already-pushed draft. To re-push (e.g.
after content edits via Ghost admin, or to start over), delete those three
fields and run again — but consider editing in Ghost admin instead, since
that's the source of truth post-publish.

## `--with-illustration` — couple this with the illustrate pipeline

The `claude "illustrate: ..."` Claude Code pipeline writes the winning
image to `apps/web/public/illustrations/blog/<slug>/<name>.webp`. Adding
`--with-illustration` to `pnpm push-blog` makes a missing hero a hard
stop instead of a warning, and prints a copy-pasteable illustrate command
seeded from the post's title + first paragraph. Typical loop:

```bash
$ pnpm push-blog spf-telco-readiness-1-july-2026 --with-illustration
No hero image detected …

Run this in another terminal …

  claude "illustrate: SPF Telco Readiness 1 July 2026 — …" --telegram

When the winner lands at apps/web/public/illustrations/blog/spf-telco-readiness-1-july-2026/<name>.webp,
re-run pnpm push-blog spf-telco-readiness-1-july-2026 …
```

Refine the brief, run `claude` in another terminal, approve the variant in
Telegram (the illustrate pipeline has its own keyboard, separate from the
post-approval keyboard). Once the winner lands in the sibling dir, re-run
`pnpm push-blog <slug>` (without `--with-illustration`) and the
sibling-dir auto-detect picks it up as the hero. Two human approvals,
zero manual frontmatter edits.

## Env required

The script needs `TELEGRAM_WEBHOOK_SECRET` exported (same value the
agent-fleet Worker holds; reused for auth). Optionally
`AGENT_FLEET_URL` to point at a non-prod Worker.

## Why two paths converge here

Two upstream sources can land in the same approval keyboard:

1. **CMO agent** (cron `0 21 * * SUN`) drafts in Notion → existing
   `request_telegram_approval` tool sends the keyboard.
2. **Founder local markdown** (this script) → `/push-blog` Worker endpoint
   creates a Ghost draft + Notion row with `kind: 'push-blog'` and sends the
   keyboard.

The Telegram callback handles both — only the on-Approve action differs:
push-blog approvals additionally publish the existing Ghost draft, while
agent-originated approvals leave Ghost untouched and rely on the
`/publish` Telegram command (run later) to publish the next batch of
Approved rows.
