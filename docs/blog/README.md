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

## Frontmatter (optional)

Smart defaults:

| Field      | Default                                                   |
| ---------- | --------------------------------------------------------- |
| `title`    | First `# H1` of the body                                  |
| `slug`     | Filename with `.md` and any leading `YYYY-MM-DD-` removed |
| `excerpt`  | First non-heading paragraph, trimmed to ~200 chars        |
| `tags`     | `[]`                                                      |
| `hero`     | None (Ghost shows no feature image)                       |
| `hero_alt` | None                                                      |
| `category` | None                                                      |

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
