# Memory index

Curated cross-session memory for this repo. How it works:

- One line per entry under the headings below, each tagged `[src: <session-id>]` so every
  belief traces to the transcript that produced it.
- Any session may **append** one-line entries directly when it learns something durable.
- **Bulk rewrites and consolidation happen only via `/dream`**, which opens a PR — the agent
  that wrote a dream never merges it. Human review is the guardrail against consolidating
  something wrong or poisoned.
- Keep this file under 200 lines. Detail that doesn't fit one line goes in a topic file
  (`memory/<topic>.md`) with a one-line pointer here. Superseded entries move to
  `memory/archive/`, not deleted.
- `memory/.scratch/` is gitignored per-session workspace.
- Never store secrets, tokens, or PII here.

## Build / tooling

## Gotchas

- A stacked PR does **not** auto-retarget to `main` when its parent merges — GitHub only re-points it if the base branch is DELETED, and our ship workflow prescribes `--delete-branch=false`. `gh pr merge` then merges it into the parent's feature branch, lands nothing on `main`, and reports success. Always re-read `gh pr view <n> --json baseRefName` after the parent lands. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- Retargeting that PR shows CONFLICTING immediately: the parent was **squash**-merged, so `main` has one new commit while the child still carries the pre-squash originals. Fix with `git rebase --onto origin/main <last-parent-sha> <child-branch>`, never a plain `git rebase main` — that replays content already in `main` and throws duplicate-conflicts that look like real disagreements. Verify with `git diff --stat origin/main..HEAD` showing only the child's own files. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- Three individually-correct PRs can compose into a defect that no per-PR review catches. #879 (scraper failure gate) + #880 (backoff un-latch) + v264 (mute `acsc`) shipped a pager that fired 8x/day for a deliberately-muted feed, because `feed_sources.muted_until` was honoured by health-digest and by nothing else. Review the merged whole, not only each diff. Fixed in #896. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- `$GITHUB_ENV` does NOT cross job boundaries — a value written there by one job arrives empty in the next. Use step `id` + `$GITHUB_OUTPUT` + a job-level `outputs:` map. Caught while wiring the scraper names into the Telegram page; would have shipped an alert permanently reading "unknown". [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- In Axiom, `fn.start` >> `fn.complete` is a per-step logging artifact, NOT dropped runs — always `dcount` the requestId first (measured 155 vs 31 raw, but 34 vs 31 distinct). Separately: `warn` is the ONLY level that bypasses the 10% INFO sampling in `packages/utils/src/axiom-logger.ts`, and as of 2026-08-05 only `enforcement.*` emits at warn, so most crons are effectively invisible. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- A handoff doc's state assertions go stale the instant the work lands. `ops-audit-2026-08-02.md` shipped with "all eight green and unmerged" and "#877 not yet merged" one commit after both stopped being true — the header was updated, the body was not. Re-grep a handoff for its own state claims after acting on it. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]
- The public consumer scan address `scan@askarthur.au` is an Exchange **distribution group** relaying to `scan@askarthur-inbound.com` via an external mail contact ("Ask Arthur Scan Pipeline") — NOT an alias or mailbox forward. M365's outbound-spam policy silently blocks inbox-rule/mailbox auto-forwarding to external domains (EAC showed "0 auto-forwarded messages" while the rule looked fine), and on the GoDaddy-resold tenant admin.microsoft.com is inaccessible but **admin.exchange.microsoft.com works** — DL group relay to a mail contact bypasses the forwarding block entirely and preserves sender + Message-ID (which reply threading, PR #912, depends on). Brendan's mailbox is also a group member as a safety-net copy. [src: session_018vZaaG7kaqzMm5wHgnsicg]

## Preferences

## Domain

- `netcraft_declined_at` has a hard discontinuity at **2026-08-09**: until v273, `advance_clone_lifecycle` stamped it `now()` with no COALESCE, and the 6h lifecycle-recheck cron calls that function with the row's OWN current state as a no-op — so every declined row's decline clock was walked forward every 6h. 859/1561 declined rows had `netcraft_declined_at = last_rechecked_at` exactly. The published decline→weaponise vendor-gap median read **2.5h (min 2.0h, n=33)** at the time of the fix against a previously-published **33h** — it had become a measurement of the recheck cadence. Pre-fix originals were overwritten in place, never archived, so the compression is UNRECOVERABLE: disclose the discontinuity in the next monthly data drop, do not smooth it, and do not publish a new median in the same cycle as the fix. [src: session_01CaT4vAimGXyiHAAqA4Wsaj]
