# NRD feed coverage — is it truncated at 70,000/day, and what does full coverage cost?

**Ticket:** [#1228](https://github.com/matchmoments-admin/ask-arthur/issues/1228) (child of map #1224) · **Researched:** 2026-09-26 · **Related:** #772 (`.au` sourcing gap), #1231 (silent caps), #1226 (honest month-over-month), ADR-0016

## Answer

1. **Yes, it is truncated, and the truncation happens at whoisds, not in our code.** The free whoisds daily file is exactly 70,000 lines every day.
2. **We see about 21% of daily registrations.** That share is not a stable random sample. On some days the file contains almost no `.com` at all.
3. **We get almost no `.au`.** About 2,160 new `.au` names are registered a day, and we saw `.au` in the file on 1 day out of 15.
4. **Full coverage is cheap.** The un-truncated list costs $9–$60 a month (USD). The binding constraints are on our side: the Inngest step-output limit, which this PR fixes, and the downstream caps in #1231.
5. **Founder decision (2026-09-26):** trial **domains-monitor Standard ($9/mo) for 30 days, side by side with the whoisds free file**, but only **after** two things:
   - the step-output fix (this PR);
   - the cap fixes in #1231.

   **Check domains-monitor's commercial licence terms before paying.**

## Evidence: the truncation

| Check                                                                           | Result                                                                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `shopfront-nrd-daily-ingest.ts` — any slice, limit or fixed line count?         | None. `parseNrdZip` kept every non-comment line of every `.txt` entry.                                               |
| whoisds free zips downloaded for 2026-09-10 … 09-24 (15 days)                   | **Every file = exactly 70,000 lines** (one `domain-names.txt`, ~1.19–1.21 MB unzipped, ~580 KB zipped)               |
| Prod: `cost_telemetry WHERE provider='whoisds'`, `metadata->>'domains_scanned'` | **89 of 89 runs since 2026-06-27 = 70000** (the ticket counted 14/14)                                                |
| whoisds' own page                                                               | Free = "Only Domains, No Whois Data". The paid "Domains Only – Daily Updates" plan ($60/mo) is the un-truncated list |

## What share of daily registrations we see

- **Total daily new registrations:**
  - domains-monitor reports **331,382** for 25 Sep 2026;
  - whoxy reports 9.81M/month, about 320k/day;
  - Verisign DNIB Q1 2026 reports 11.5M new `.com` + `.net` per quarter, about **128k/day**.
- **What our file contains:**
  - `.com` 21–27k/day plus about 1.5k `.net`, which is **~20% of new `.com`/`.net`**;
  - **~21% of everything** (70k / ~331k).
- **The sample is not stable.** On most days the file is shuffled: 24 Sep had 58,986 runs of consecutive same-TLD lines across its 70k lines. The exceptions matter:
  - **11 Sep 2026: zero `.com`.** The file was a registry-grouped batch: 35k `.xyz`, 17k `.top`, 6k `.cfd`. The run that read it (12 Sep) found **5 hits**, against 21–44 on every other day of that fortnight. That is a real drop in how much we caught, and the telemetry did not flag it.
  - **19 Sep 2026: 475 `.au` names**, 20.7k `.cn`, and only 12.4k `.com`.
- **Consequence:** our counts are roughly a 1-in-5 sample on average, and occasionally close to a 0-in-5 sample for `.com`. The mix of TLDs is outside our control. Any month-over-month clone count (#1226) sits on top of this.

## `.au` (#772)

- auDA's July 2026 registry report: **66,911 new `.au` names in the month (~2,160/day)**, 4,400,684 under management, and new registrations up 19% year on year.
- whoisds free file: `.au` appeared on **1 of 15 days** (475 names, 19 Sep). All 6 `.au` clone alerts ever recorded came from the NRD run on days like that. Their `fired_at` is 08:30, the NRD cron time.
- **auDA publishes no zone file.** There is no CZDS equivalent for `.au`. Access is RDAP/WHOIS lookups of one domain at a time.
- **CT sourcing is dead** (ADR-0016 amendment, 2026-07-17): certstream returns zero frames and crt.sh fails on every access pattern.
- **Commercial options:**
  - **domains-monitor:** publishes a `.au` zone list plus a daily `.au` new-domains file, included in its $9/$29/$79 plans. It shows **2.52M of the 4.40M** registered `.au` names (~57%). This is presumably because it builds the list from DNS observation rather than registry data, so assume it under-counts `.au`.
  - **whoisds "Australia Whois Database Updates":** $80/mo, and includes registrant WHOIS data. Worth paying for only if the ABN cross-check (`FF_CLONE_WATCH_AU_REGISTRANT`) needs registrant fields.
  - **whoisds "US & Australia NRD Updates":** $190/mo.

## Options

Prices are USD, taken from vendor pages on 2026-09-26.

| Source                                        | Coverage                                                                                   | Cost/mo                   | Fields                              | Effort                                                                                                                                                                       | ToS / licensing                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **whoisds free** (current)                    | 70k/day, ~21%, mix outside our control, `.au` ≈ never                                      | $0                        | domain only                         | —                                                                                                                                                                            | Free "including for commercial purposes, without a license"                                   |
| whoisds Domains Only – Daily                  | Full daily list (their gTLD set plus some ccTLDs)                                          | $60 ($650/yr)             | domain only                         | **S**: same zip format and parser; add an authenticated URL                                                                                                                  | Paid licence; read terms before redistributing                                                |
| whoisds Created/Updated/Expiry                | Full list + dates                                                                          | $99 ($999/yr)             | + create/expiry dates               | S                                                                                                                                                                            | Paid                                                                                          |
| whoisds Australia Whois Updates               | `.au` NRD + WHOIS                                                                          | $80                       | registrant WHOIS                    | S–M: a second source                                                                                                                                                         | Paid                                                                                          |
| **domains-monitor** Standard / Pro / Ultimate | "All zones — gTLD, ccTLD", ~331k/day; daily `.au` file (~57% of the `.au` zone)            | **$9** / $29 / $79        | domain; Pro adds email/geo, DNS TXT | S–M: API or file download, new parser                                                                                                                                        | **Unverified: check commercial use and derived-data terms before paying (founder condition)** |
| whoxy NRD                                     | ~320k/day, gTLD + ngTLD                                                                    | $495                      | full parsed WHOIS                   | S                                                                                                                                                                            | Paid; no trial                                                                                |
| WhoisXML NRD                                  | gTLD + ccTLD tiers                                                                         | quote only (not verified) | WHOIS / DNS                         | S                                                                                                                                                                            | Paid                                                                                          |
| ICANN CZDS zone-file diffs                    | Complete for approved gTLDs incl. `.com` (each registry approves separately); **no `.au`** | $0                        | domain + NS                         | **M–L**: `.com` zone is tens of GB a day to download and diff; storage; approvals renew; misses same-day-deleted names (DarkDNS: ≥1% of short-lived, often malicious, names) | Free, but restrictive: no redistribution, use limited to the approved purpose                 |
| CT logs (certstream / crt.sh)                 | —                                                                                          | —                         | —                                   | dead per ADR-0016                                                                                                                                                            | —                                                                                             |

## Recommendation (founder decision recorded)

1. **Ship the step-output fix first** (this PR). No bigger feed can run without it. See below.
2. **Fix the silent caps in #1231 before raising volume.** At the full feed, expect **~4–5× the hits (~130–150 alerts/day)**. The preclassify fan-out (`list_clone_alerts_pending_preclassify` with `p_limit: 50`) would immediately become a new silent cap, as would the urlscan submit/retrieve budgets. Cite `worklist-gate-starvation-rule` for any gate change.
3. **Then trial domains-monitor Standard ($9/mo) for 30 days, side by side** with whoisds free. **First confirm its licence allows commercial use of derived alerts.** Measure daily:
   - total domain count, `.com` count, `.au` count;
   - hits and new alert rows;
   - overlap with whoisds.

   If it gives the expected ~4–5× hit uplift and steady `.com` volume, keep it. If it doesn't, fall back to **whoisds Domains Only ($60/mo)**: known format, same parser, only an authenticated URL.

4. **`.au`:** measure domains-monitor's daily `.au` file during the same trial. Buy whoisds Australia ($80/mo) only if the ABN cross-check needs registrant data. #772 stays demand-gated per ADR-0016.
5. **CZDS:** not now. The engineering and storage effort outweighs a $9–$60/mo feed. Revisit only if vendor coverage proves poor.
6. **Monthly report (#1226):**
   - 2026-06 to 2026-09 counts are a **~21% sample with a daily mix outside our control**;
   - a feed switch is a **coverage change**, so suppress the month-over-month delta across it and label it;
   - note known low-coverage days (e.g. 11 Sep).

## Step-output fix (shipped in this PR)

**Problem.**

- Step 1 (`download-and-parse-nrd`) returned `domains: string[]`, about 1.4 MB of JSON at 70k lines.
- Inngest limits step output to **4 MB per step AND 4 MB across all steps of a run**, and re-sends memoised output on every later step (six of them here).
- At a full ~330k/day feed the list alone is about 6.6 MB, so the run would fail outright on the first paid day.

**Fix.**

- Download, parse and match now run in **one step, `download-parse-match-nrd`**, which returns only `{ domains_scanned, hits }`.
- `scanNrdZip(zip, watchlist)` matches each line as it is parsed, so the domain list is never materialised across a step.
- The Lane Outcome row, Telegram digest, upsert chunking (5k) and return shape are unchanged. `domains_scanned` is now a counted number instead of `domains.length`.

**Tests** (`src/inngest/__tests__/shopfront-nrd-scan-step-output.test.ts`):

- **350k-line generated fixture:**
  - the step's JSON output is under 256 KB;
  - the old step-1 return is over 4 MB on the same fixture, so the test would fail against the old shape.
- **20k-line fixture, full watchlist:** `scanNrdZip` returns exactly the hits (and order) of an independent parse-then-`lexicalMatch` oracle.
- Line rules (comments, blanks, case, trim) are pinned.

**Duration.**

- Matching costs ~0.2 ms/domain against the full watchlist: ~16 s at 70k, **~80 s at 350k** on a dev laptop.
- The whole step runs in one invocation under `/api/inngest` `maxDuration = 300`.
- That fits, but re-measure against a real paid file before switching. If needed, split matching by line range across steps, each returning only hits.

## Sources

- whoisds: <https://www.whoisds.com/newly-registered-domains>, <https://www.whoisds.com/pricing>
- domains-monitor: <https://domains-monitor.com/update/>, <https://domains-monitor.com/zone/au/>, <https://domains-monitor.com/price/>
- whoxy: <https://www.whoxy.com/newly-registered-domains/>
- Verisign DNIB Q1/Q2 2026: <https://blog.verisign.com/domain-names/q2-2026-domain-name-industry-brief-quarterly-report>
- auDA Registry Monthly Statistics, July 2026: <https://files.auda.org.au/documents/Registry-Monthly-Stats-July-2026.pdf>
- ICANN CZDS: <https://czds.icann.org/help>; DarkDNS (snapshot gaps on short-lived names): <https://arxiv.org/pdf/2405.12010>
- Inngest usage limits: <https://www.inngest.com/docs/usage-limits/inngest>
- Primary evidence: whoisds free zips 2026-09-10…24 downloaded and line-counted; prod `cost_telemetry` (provider `whoisds`) and `shopfront_clone_alerts` queries, 2026-09-26.
