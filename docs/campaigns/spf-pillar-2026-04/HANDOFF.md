# Handoff — SPF pillar campaign

What's done in the repo, what's left for you to do, and the day-by-day timeline you're now working against.

## What I did this run

### Files preserved in the repo

```
docs/campaigns/spf-pillar-2026-04/
├── README.md                          campaign index + execution timeline
├── HANDOFF.md                         (this file)
├── 00-master-cover.md                 verification summary
├── 01-pillar-blog-post.md             ~3,000 words pillar (Day 0 publish)
├── 02-email-davidson-idcare.md        Day 1 outreach
├── 03-email-chiarelli-tpg.md          Day 8 outreach
├── 04-email-walsh-vocus.md            Day 15+ outreach (warm intro)
├── 05-blog-supporting-1-penalty-units.md   Day 10 publish
├── 06-blog-supporting-2-sender-id.md  Day 14 publish
├── 07-blog-supporting-3-five-fines.md Day 7 publish
├── 08-linkedin-series.md              6 posts, 30-day cadence
├── 09-aea-grant-narrative.md          requires UNSW partnership in writing first
├── 10-treasury-submission.md          for next open Treasury/ACCC/ACMA consultation
├── 11-claude-code-instructions.md     original implementation instructions
├── audit/                             4 audit reports + summary
│   ├── 00-summary.md
│   ├── 01-audit.md                    pillar — 86/100, ship-ready
│   ├── 05-audit.md                    penalty units — 71/100
│   ├── 06-audit.md                    sender ID — 76/100
│   └── 07-audit.md                    five fines — 80/100
└── diagrams/                          4 .excalidraw + PNG previews + builder
    ├── acma-fines-timeline.excalidraw
    ├── acma-fines-timeline.png
    ├── regulatory-architecture.excalidraw
    ├── regulatory-architecture.png
    ├── 1-july-2026-simultaneity.excalidraw
    ├── 1-july-2026-simultaneity.png
    ├── buyer-vs-builder.excalidraw
    ├── buyer-vs-builder.png
    └── build_spf_diagrams.py          regenerate any diagram by editing + re-running
```

### Code added

- `apps/web/scripts/seed-spf-pillar-blogs.ts` — reads canonical markdown from `docs/campaigns/spf-pillar-2026-04/`, strips H1+subtitle+separator, upserts 4 blogs as **draft** status (review in `/admin/blog` before publishing). Idempotent on re-run.

### Skill repo (separate)

- `~/Desktop/skills/skills/blog/personas/askarthur-house.md` — codified house voice. Already auto-committed back to the `skills` repo via the symlink. Active persona is now `askarthur-house`.

### Audit headlines

All 4 posts are well-structured, on-voice, with strong sourcing and zero AI-prose tells. They lose points on the same 3 dimensions:

| Issue                           | Posts affected | Per-post pt loss | Cluster lift if fixed          |
| ------------------------------- | -------------- | ---------------: | ------------------------------ |
| No FAQ section                  | All 4          |               -4 | +16 pts; +20% AI-citation odds |
| No Key Takeaways callout        | All 4          |               -3 | +12 pts                        |
| No internal links between posts | All 4          |               -4 | +16 pts (after publication)    |

If you apply all three to all four posts, scores move from `86/71/76/80` to `97/84/89/93`. The audit reports include drafted Key Takeaways + FAQ Q&A pairs for each post — paste-ready.

## What needs you (in execution order)

### Right now (before Day 0)

1. **Read the audit summary** — `docs/campaigns/spf-pillar-2026-04/audit/00-summary.md`. 5 minutes.
2. **Decide on the FAQ + Key Takeaways patches.** Each per-post audit (`01-audit.md`, `05-audit.md`, `06-audit.md`, `07-audit.md`) has drafted callouts and FAQ Q&As you can paste into the .md files. If you want me to do this in a follow-up run, say the word.
3. **Review the diagrams.** Open the four `.excalidraw` files at <https://excalidraw.com> (drag-and-drop). Edit anything that needs your judgment. The PNG previews are layout-validation only — Excalidraw itself wraps text and looks cleaner than the PNGs.

### Day 0 (publication day)

4. **Run the seed script:**
   ```bash
   cd apps/web
   npx tsx scripts/seed-spf-pillar-blogs.ts
   ```
   Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your env. Posts insert as `draft`.
5. **Open `/admin/blog`** (production) or `http://localhost:3000/admin/blog` (local). Verify the pillar:
   - Mermaid diagrams render
   - Tables render as HTML
   - `is_featured: true` set
   - Title and meta description look right
     Flip pillar status to `published`.
6. **Post LinkedIn 1** from `08-linkedin-series.md`. Comment with the pillar URL.
7. **Send Davidson IDCARE letter** per `02-email-davidson-idcare.md`. Paper letter first to the Sippy Downs QLD address (idcare.org/contact-us), then email follow-up via the contact form within 48h. Print on AskArthur letterhead.

### Day 4

8. Post LinkedIn 2.

### Day 7

9. Publish supporting blog 3 (`five-telcos-twelve-months-acma-pattern`) — flip status from draft to published in `/admin/blog`.

### Day 8

10. Post LinkedIn 3.
11. Send Chiarelli TPG email per `03-email-chiarelli-tpg.md`. LinkedIn InMail first; verify Chiarelli's LinkedIn URL before sending.

### Day 10

12. Publish supporting blog 1 (`spf-159745-penalty-units-explained`).

### Day 13

13. Post LinkedIn 4.

### Day 14

14. Publish supporting blog 2 (`sms-sender-id-register-cio-guide-2026`).

### Day 15+

15. **If Davidson has acknowledged the IDCARE letter:** request the Walsh / Vocus warm intro.
16. **Send Walsh email** per `04-email-walsh-vocus.md` only after either (a) IDCARE intro confirmed, or (b) 30 days elapsed with no IDCARE traction.

### Day 18

17. Post LinkedIn 5.

### Day 21

18. Approach UNSW Parwada (`jerry.parwada@unsw.edu.au`) about AEA partnership. Do not draft AEA application until partnership in writing.

### Day 25

19. Post LinkedIn 6 (the IDCARE pivot post).

### Day 30+

20. Once AEA partnership is in writing, draft application using `09-aea-grant-narrative.md` skeleton.
21. Watch Treasury / ACCC / ACMA for next open SPF subordinate-rules consultation; submit using `10-treasury-submission.md` outline.
22. Federal Budget 12 May 2026 — monitor for NASC / SPF allocations.

### Post-publication housekeeping

23. **Internal-link the supporting posts back to the pillar.** After all four are live, edit each supporting post in `/admin/blog` to link to the pillar in its first paragraph. Edit the pillar to link out to the three supporting posts in the relevant sections. (Per `~/.claude/skills/blog/references/internal-linking.md`.)
24. **Submit URLs to Google Search Console** for explicit indexing. The compliance category page should also be re-submitted.

## Things you specifically asked for that are NOT done (and why)

- **AISA CyberCon Melbourne speaker submission.** CFP closed 15 April 2026. Defer to AISA branch events (smaller, monthly slots) and 2027 main programme CFP.
- **Optus outreach.** Deferred to Q3 2026 per the master plan — Optus is mid-leadership-rebuild.
- **Telstra outreach.** Telstra is a competitor (Quantium Telstra), not a customer.
- **Cold outreach to Apate.ai or Truyu.** Peer-not-competitor relationships; structured intros via OIF Ventures or x15ventures preferable.
- **Banking / mid-tier ADI outreach.** A separate workstream — `09-aea-grant-narrative.md` references COBA as the right channel.

## Branch / commit state

Currently on `content/spf-pillar-campaign` (cut from `docs/safe-variant-design-system` HEAD). Untracked files only — nothing committed. Your in-progress design-system work is preserved exactly where you left it.

When ready to commit, stage **only** the campaign files and seed script:

```bash
git add docs/campaigns/spf-pillar-2026-04/ apps/web/scripts/seed-spf-pillar-blogs.ts
git commit -m "feat(content): SPF pillar campaign — 11 deliverables, audit, diagrams, seed script"
```

Do NOT `git add -A` — the working tree has unrelated design-system changes you don't want to bundle in.

## Success metrics (30 days post-launch)

Campaign succeeds if **any 3 of 6** are achieved:

1. Pillar indexes top 10 Google for "SPF Act telco compliance" (AU queries)
2. ≥5 inbound enquiries via askarthur.au or brendan@askarthur.au
3. Confirmed meeting with Charlotte Davidson (IDCARE)
4. Confirmed discovery call with TPG (Chiarelli or Singh) or Vocus (Walsh)
5. Signed academic partnership letter with UNSW (Parwada)
6. Submitted Treasury / ACCC / ACMA consultation on the public record

## What was added in the second run (28 April 2026)

### KT + FAQ patches applied to all 4 markdown files

Word counts after patches:

- Pillar: 2,991 → 3,431 (+440)
- Penalty units: 1,177 → 1,613 (+436) — over the 1,500 informational floor
- Sender ID: 1,119 → 1,498 (+379) — at the floor
- Five fines: 1,183 → 1,677 (+494) — over the floor

Projected scores after patches:

- Pillar 86 → ~97
- Penalty units 71 → ~84
- Sender ID 76 → ~89
- Five fines 80 → ~93

### Hero illustrations + diagrams converted to WebP

Originals (source-of-truth): `docs/campaigns/spf-pillar-2026-04/illustrations/*.jpeg` + `diagrams/*.png`

Web-optimised WebP files at `apps/web/public/illustrations/blog/spf-pillar-2026-04/`:

- `pillar-hero-a-calendar.webp` — figure with July 2026 wall calendar, three sticky notes (SPF Act / Sender ID / Penalty Indexation). 157KB. **Active hero for the pillar.**
- `pillar-hero-b-folders.webp` — figure beside stack of six labelled telco folders with INFRINGEMENT stamp. 128KB. **Active hero for the five-fines post.**
- `pillar-hero-c-crossroads.webp` — two figures at BUILD/BUY signpost. 143KB. Available — could be hero for penalty-units or sender-id post if you want.
- 4× diagram WebPs (timeline, regulatory architecture, simultaneity, buyer-vs-builder). 195–270KB each.

Total compression: 7.12MB → 1.31MB (82% savings). Diagrams at q=92 to preserve text crispness; illustrations at q=85.

Cost: $0.90 in Gemini API credits for the 3 illustrations.

### Reddit + HN distribution artefacts

`docs/campaigns/spf-pillar-2026-04/distribution/`:

- `reddit-r-AusFinance.md` — title, first-comment seed (200-400 words with disclosed conflict), publishing notes, anticipated critiques and reply patterns
- `hn-submission.md` — recommended title, optional submission text, lifecycle expectations, when NOT to submit

Both follow the per-channel etiquette in `~/.claude/skills/blog/references/distribution-channels.md`.

### Seed script updated

`hero_image_url` now set on:

- Pillar → `pillar-hero-a-calendar.webp`
- Five fines → `pillar-hero-b-folders.webp`

The other two posts (penalty units, sender ID) remain `null` — set them via the admin UI if you want to add a hero, or leave bare.

## Still optional, still possible

Things I can do in another follow-up run if useful:

- **Embed the diagrams inline in the blog bodies** (currently the 4 diagrams sit in `public/illustrations/` unreferenced — not auto-embedded because where to place them is an editorial decision). The audit reports note suggested placement points per post.
- **Draft the Twitter/X thread version of the pillar** (separate from the LinkedIn series — different platform, different cadence, different sentence units).
- **Build a `compliance` blog category landing page** that shows all four SPF posts as a cluster with the Key Takeaways visible.
- **Generate hero illustrations for the supporting posts** (penalty-units, sender-id) if you want full visual coverage. ~$0.60 for 2 more.
- **Re-audit the patched posts** to confirm the projected score lifts actually land.

Just ask.
