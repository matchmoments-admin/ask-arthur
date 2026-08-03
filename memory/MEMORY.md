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
- A handoff doc's state assertions go stale the instant the work lands. `ops-audit-2026-08-02.md` shipped with "all eight green and unmerged" and "#877 not yet merged" one commit after both stopped being true — the header was updated, the body was not. Re-grep a handoff for its own state claims after acting on it. [src: session_01HQRVXxTwyL3b1TkZtxCsMN]

## Preferences

## Domain
