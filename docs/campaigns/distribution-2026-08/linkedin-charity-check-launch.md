# LinkedIn launch post — charity checking in the one box

_#933 item 2, re-angled 2026-08-08 (founder decision): the story is the ONE BOX — the main scanner recognises a charity ask and checks the register inline. No separate tool to find._
_Facts verified 2026-08-07/08: 66,484 rows in `acnc_charities` (prod count, exact); typosquat → HIGH_RISK hard floor (`scorer.ts`); inline detection + register check live and browser-tested on prod (v0.2e, PRs #956–#959)._
_Signal: charity checks/week (`cost_telemetry feature LIKE 'charity%'` — counts both the inline flow and the page)._

## Post body

Someone knocks on your door with a laminated ID and a donation tin.

Two minutes ago, you'd never heard of the charity.

Here's the new move: paste what they said into Ask Arthur →

Australians are generous — and scammers know it. Fake charities spike after every flood, fire and cyclone, precisely when your guard is down and your heart is open.

So we taught our scam checker to recognise a charity ask on its own. No separate tool, no menu to find:

— Paste the pitch — the flyer, the text, the doorknock spiel — into the same box at askarthur.au you'd paste anything suspicious
— Arthur spots that it's a charity ask and checks the name against all 66,484 registered Australian charities, refreshed daily from the ACNC register
— One more click shows the register verdict right there — including the lookalikes: "Astralian Red Cross", one letter off, comes back high-risk, not "no results found"

That last part is the point. A fake charity's name is designed to be one squint away from a real one. A plain register search says "no results" — which feels like an error. Arthur says: this looks like a deliberate near-miss of a real charity, and here's the real one.

And if they're asking for gift cards, cash or a bank transfer to a personal account — that's the conversation over. No legitimate Australian charity collects that way.

Doorknock, phone call, disaster appeal: one box, one paste, then give with confidence.

Free, no signup.

If you've got a parent who gives to everything: send them this before the next appeal season.

PS — Ask Arthur is a free scam-detection tool by Young Milton Pty Ltd (Sydney). Not affiliated with the ACNC or any government agency.

## Hashtags

#ScamAwareness #Charity #Australia #OnlineSafety

## First comment (pre-staged — link lives here, not in the body)

Try it now: https://askarthur.au/?utm_source=linkedin&utm_campaign=charity-check-launch&utm_medium=social — paste any suspicious message, link or charity ask. Free, no signup, all 66,484 ACNC-registered charities behind it.

## Publish notes

- Window: Tue–Thu, 7–9am AEST. Space at least a few days from the scan@ post — one launch at a time.
- Image suggestion: the founder's own two-screenshot sequence from testing — the "Charity check — we'll verify against the ACNC and ABR registers" chip appearing above the pasted doorknock message, then the "This looks like a scam / Stop: we can't find this charity on the ACNC register" verdict. Real product, real verdict, zero mockups.
- Superseded version (dedicated /charity-check-page angle) lives in git history if ever needed; the page itself remains live as the deep-check surface.
