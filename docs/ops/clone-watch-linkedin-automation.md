# Clone Watch → LinkedIn — monthly automation (ops)

Recurring "Australian Clone Watch" LinkedIn post. **Design confirmed 2026-07-05:**
GitHub Actions host + deterministic caption + native required-reviewer approval
gate. Reuses the existing render + publish scripts; no serverless Chromium, no
Inngest cost.

Workflow: [`.github/workflows/clone-watch-linkedin.yml`](../../.github/workflows/clone-watch-linkedin.yml).

## The monthly loop

1. **`prepare` job** (cron ~2nd of month, or manual) renders the 7-slide carousel
   PDF against **prod** (`report-card:export --base=https://askarthur.au`) and
   generates the caption + first-comment from live data
   (`clone-watch:caption`) — numbers reconcile to the internal digest. Uploads
   the edition as an artifact and pings Telegram with the run link + caption.
2. **You approve** the `publish` job in the GitHub Actions UI (the Telegram ping
   links straight to it). Nothing publishes without this.
3. **`publish` job** publishes the document post to the Ask Arthur company page
   and pings Telegram with the post URL + the two manual steps.
4. **You do the two things the API can't** (Community Management **Dev-Tier**):
   paste the first comment (the link), and reshare from your personal profile.

The durable per-month record (`clone_watch_report_summary`) is written
separately by the `clone-watch-report-summary` Inngest cron (1st of month) — the
LinkedIn post reads live data, so the two are decoupled.

## One-time setup

### 1. Repository secrets (Settings → Secrets and variables → Actions)

| Secret                                                                                                                    | Reuse from             | Purpose                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `ADMIN_SECRET`                                                                                                            | prod env               | mints the admin cookie so the export can render the gated route |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                                                | prod env               | caption generator's service client                              |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                               | prod env               | caption generator's service client                              |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_REFRESH_TOKEN` / `LINKEDIN_ACCESS_TOKEN` / `LINKEDIN_ORG_URN` | repo-root `.env.local` | publish (refresh-grant → upload → post)                         |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID`                                                                           | prod env               | the review + confirmation pings                                 |

### 2. The approval gate (required — this IS the gate)

Settings → Environments → **New environment** → name it exactly
**`clone-watch-linkedin`** → enable **Required reviewers** → add yourself. The
`publish` job targets this environment, so it pauses until you approve.

## Dry run (before enabling the cron)

1. Actions → **Clone Watch → LinkedIn (monthly)** → **Run workflow** (leave month
   blank for the prior month, or set `YYYY-MM`).
2. Watch `prepare`: confirm the PDF renders and the caption looks right (download
   the `clone-watch-edition` artifact). You'll get the Telegram review ping.
3. `publish` will be **Waiting** for your review. Only approve once the artifact
   is correct **and** you've deleted any prior post for that month.
4. After it publishes: paste the first comment, reshare from your profile.

## Go live

Uncomment the `schedule:` block in the workflow (`0 1 2 * *` = 2nd of month,
~11:00 AEST). The approval gate still applies every month.

## Troubleshooting

- **Chromium fails in `prepare`** — the workflow runs `puppeteer browsers install
chrome`; if system libs are missing on the runner, add
  `sudo apt-get install -y libnss3 libatk1.0-0 libgbm1 libasound2` before it.
- **Token refresh fails** — the refresh token expired; re-mint with
  `~/Desktop/AskArthur-CloneWatch-June2026/linkedin-token-mint.mjs` and update
  the `LINKEDIN_REFRESH_TOKEN` secret. The publisher prefers the refresh grant
  and only falls back to `LINKEDIN_ACCESS_TOKEN` if id/secret are missing.
- **Comment 403** — expected on Dev-Tier; the publish succeeds anyway and the
  first-comment text is surfaced in the Telegram ping to paste by hand. (Lifts
  automatically if LinkedIn grants the comment permission.)
- **`/clone-watch/method` link** — once that page ships, pass
  `--method-url=https://askarthur.au/clone-watch/method` to `clone-watch:caption`
  in the workflow to add the "How we count these →" citation line to the first
  comment.

## Constraints (by design)

- API posts to the **company page only** → personal reshare is always manual.
- The first comment (the link) is always **pasted by hand** (Dev-Tier).
- A human approves **every** post — no unattended publishing.
- Every number comes from live data, reconciled to the digest.
