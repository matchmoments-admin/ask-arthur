# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Local usage note — `needs-info` doubles as "gated on measurement / data"

In this tracker, `needs-info` is also applied to issues that are fully
specified but blocked on a feature-flag measurement window or
upstream-data window before they can move to `ready-for-agent`. This
extends — not replaces — the canonical Matt Pocock framework definition
("waiting on reporter for more information"): the gating dependency is
data the reporter (us, in this case) is waiting on, not a clarifying
question.

Current examples: issues #319, #320, #321, #322, #323 (Shop Signal
Stage 1+ — gated on the 30-day Stage-0 measurement window in
`docs/ops/shop-signal-measurement.md`).
