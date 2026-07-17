# Extension Facebook-fixture refresh playbook

The extension's Facebook detectors (`apps/extension/src/lib/ad-detector.ts`,
`marketplace-detector.ts`) parse Facebook's obfuscated DOM. Facebook ships DOM
changes silently and without notice; when the selectors rot, the feature
degrades with **no error anywhere** (audit issue 04-p2). The fixture tests in
`apps/extension/test/` are the tripwire — but only if the fixtures track the
DOM Facebook actually serves.

## Cadence

**Quarterly**, or immediately when any of:

- the in-feed ad banners stop appearing during a manual smoke of a logged-in
  Facebook feed with the `WXT_FACEBOOK_ADS=true` build;
- `flagged_ads` / `deepfake_detections` insert volume drops to ~zero without a
  corresponding flag change;
- Facebook visibly reshuffles the feed UI.

## Capture

1. Build and load the unpacked extension (`WXT_FACEBOOK_ADS=true pnpm --filter
@askarthur/extension build`), or just browse facebook.com in a normal
   session with DevTools.
2. In DevTools, find a sponsored feed unit (`[data-pagelet^="FeedUnit_"]` or
   `[role="article"]` that shows a Sponsored label). Right-click the element →
   Copy → Copy outerHTML.
3. Repeat for: a plain sponsored unit, a fragmented-span sponsored unit (the
   label under `a[href="#"] > span[aria-labelledby]` spans), an organic post,
   and a Marketplace listing page's `[role="main"]`.

## Sanitise (MANDATORY before committing)

Fixtures are committed to a public-ish repo — treat everything in the capture
as PII until replaced:

- Replace all personal names, profile hrefs/ids, advertiser names, and photo
  URLs with obviously fake equivalents (keep the **hostname shape** — e.g.
  `scontent.xx.fbcdn.net` — because the detectors match on it).
- Strip tracking params, session tokens, `__cft__`/`__tn__` querystrings,
  React data-attributes with user ids, and comments count/social context.
- Keep the **structural** attributes the detectors rely on: `data-pagelet`,
  `role`, `aria-label(ledby)`, `dir="auto"`, inline `style` hiding on decoy
  spans, `l.facebook.com/l.php?u=` redirect shape, `width`/`height` attrs on
  images (the jsdom shims in `test/setup.ts` read intrinsic size from them).

## Commit

- Name with a date suffix: `feed-sponsored-YYYY-MM.html` etc. in
  `apps/extension/test/fixtures/facebook/`. Replace the old file (git history
  keeps the lineage) and update the header comment.
- Run `pnpm --filter @askarthur/extension test`. A failure after a refresh is
  the system working: either the fixture was sanitised too aggressively, or a
  detector genuinely no longer matches current Facebook DOM — fix the
  detector, not the assertion.

## jsdom caveats (why test/setup.ts exists)

jsdom does no layout: `offsetWidth`/`offsetHeight` are always 0, `innerText`
is missing, images never load (`naturalWidth` 0). `test/setup.ts` shims these
with deterministic semantics (inline-style-driven visibility; `width`/`height`
attributes as intrinsic size; `innerText` → `textContent`). The vitest env
sets `url: "https://www.facebook.com/"` so relative hrefs (`href="#"`) resolve
to a facebook origin exactly as they do in production — don't remove that or
the landing-URL extraction tests will see phantom external links.

## Known detector quirk (do not mask in fixtures)

`extractSellerProfile`'s location regex includes a bare `From` alternative
that matches mid-sentence "from …" in listing descriptions and captures
garbage. Fixtures avoid the word "from" in descriptions to test the intended
path; the quirk itself is tracked for a proper fix (word-boundary/anchor) —
see PR notes for `feat/extension-test-infra`.
