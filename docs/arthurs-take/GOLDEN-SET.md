# Arthur's Take — Golden Set (proposed, awaiting human labels)

47 Reddit posts sampled from prod on 2026-09-04, stratified across all 15 `intent_label` values
(3 per label; 4 each for `informational` and `other`, the classes where a not-a-scam judgement is
most likely). Every candidate was classified under prompt `reddit-intel-v2@2026-06-28` and has a
description of at least 200 characters, so none would be suppressed by the short-body rule.

## What this is for

Two gates depend on it:

- **Gate 2** — a fixed regression set for the take-writer prompt. A prompt change that lowers
  agreement on this set does not ship.
- **Gate 2 / 3** — the model comparison (Haiku 4.5 vs Sonnet 4.6 vs Sonnet 5) for the classifier
  per `DECISIONS.md` X12. Switch only at ≥95% label agreement.

It lives as fixtures under `evals/fixtures/reddit-intel/` in the existing three-layer eval structure
rather than as a new harness. **The live run must print its call count** — `evals/e2e/run.mjs:19-22`
records promptfoo reporting green 24/24 for 86 days without ever having executed, and a `skipIf`
suite reads green when skipped.

## How to label

For each row record two things, ignoring what the model said:

1. `is_scam_report` — is this post a first-hand or second-hand report of a scam? (An awareness post,
   a question with no scam in it, or a dispute that turns out to be legitimate is `false`.)
2. `label` — the correct value from the 15-value taxonomy in
   `supabase/migration-v82-reddit-intel-base.sql:41-47`.

Optionally add `notes` where the model's label is defensible but not what you would pick — those are
the calibration cases worth keeping.

Fetch a post's full text with:

```sql
select id, title, description, source_url, country_code
from feed_items where id = <feed_item_id>;
```

## Candidates

The `model label` column is the classifier's current output. It is shown for convenience and must
**not** anchor the human label — it is the thing being measured.

| feed_item_id | model label        | conf | country | len | title                                                                  |
| ------------ | ------------------ | ---- | ------- | --- | ---------------------------------------------------------------------- |
| 41994        | `advance_fee`      | 0.88 | —       | 500 | Is this a scam? Shipping payment required?                             |
| 42117        | `advance_fee`      | 0.82 | IN      | 500 | [In] Amazon gift card scam?                                            |
| 42183        | `advance_fee`      | 0.87 | US      | 394 | [US] is Petrovia Search and Rescue a scam?                             |
| 41147        | `email_scam`       | 0.70 | —       | 436 | How to set up a rule for these emails?                                 |
| 41163        | `email_scam`       | 0.75 | —       | 500 | Many phishing emails sent to me today randomly all to the same strange |
| 41405        | `email_scam`       | 0.85 | US      | 500 | [US] Is there a way to stop mass spammy scam emails after my email was |
| 42116        | `employment_scam`  | 0.75 | —       | 500 | CVS interviewer wants me to send resume to a personal Gmail address    |
| 42185        | `employment_scam`  | 0.85 | —       | 500 | Received "HIRINING OFFER"                                              |
| 42230        | `employment_scam`  | 0.92 | —       | 500 | US-Nationwide remote job scam with United Thai Boxing & MMA            |
| 42186        | `impersonation`    | 0.80 | US      | 500 | [US] Someone hacked my walmart.com account or created a new one with m |
| 42224        | `impersonation`    | 0.82 | —       | 500 | email credit card approval from capital one                            |
| 42228        | `impersonation`    | 0.93 | ES      | 500 | [ES] Scammers as a bank manager                                        |
| 42060        | `informational`    | 0.72 | —       | 500 | How can we contact a possibily legitimate company (Finders Internation |
| 42082        | `informational`    | 0.55 | ID      | 500 | [ID] Suspicious Job-seeking/Freelancer Site: VirtUp                    |
| 42184        | `informational`    | 0.95 | —       | 500 | MyChart Scams (U.S.)                                                   |
| 42188        | `informational`    | 0.98 | —       | 500 | Hi Reddit! I'm Kathy Stokes, Fraud Expert at AARP. AMA on scams and fr |
| 41482        | `investment_fraud` | 0.91 | IT      | 500 | Bonchat & Axa1565.com Scam? [IT]                                       |
| 42054        | `investment_fraud` | 0.93 | US      | 500 | [US] Anyone hear of Quantelligence.com in context of stocks? Stay away |
| 42189        | `investment_fraud` | 0.93 | US      | 500 | [US] pump and dump Whatsapp scam                                       |
| 42115        | `other`            | 0.80 | US      | 500 | [US] Behold, the “beg bounty” scam                                     |
| 42191        | `other`            | 0.72 | US      | 500 | [US] I am being framed for a crypto scam and they called the police on |
| 42223        | `other`            | 0.55 | —       | 500 | Getting a lot of TikTok Shop Partner Center one time codes             |
| 42225        | `other`            | 0.60 | US      | 500 | [US] Personal claiming our packet is theirs                            |
| 42017        | `phishing`         | 0.85 | —       | 500 | Hacker keeps activating my Apple account                               |
| 42055        | `phishing`         | 0.75 | —       | 500 | Question. Unknown debit card addition to Amazon account. USA           |
| 42229        | `phishing`         | 0.95 | US      | 500 | [US] New Walmart scam walmart.jsxnc.com                                |
| 41993        | `phone_scam`       | 0.82 | —       | 500 | [US,NY] "Division Insura" Michigan                                     |
| 42084        | `phone_scam`       | 0.62 | MX      | 500 | Uber codes I didn't ask [MX]                                           |
| 42182        | `phone_scam`       | 0.85 | —       | 500 | (US) Hello! Someone called my mom from my phone number and demanded a  |
| 40036        | `rental_scam`      | 0.87 | TH      | 500 | [TH] Crypto Payments Scam Alerts                                       |
| 42049        | `rental_scam`      | 0.95 | —       | 500 | Just got scammed out of $70 on venmo. Feeling extremely stupid, help m |
| 42059        | `rental_scam`      | 0.96 | —       | 500 | [EU] Fallen victim of a room rental scam                               |
| 41710        | `romance_scam`     | 0.95 | US      | 500 | [US] Help explaining how a scam works to Mom                           |
| 41806        | `romance_scam`     | 0.97 | —       | 500 | Mother has been scammed out of $300k in just 12 months. One of the wor |
| 41895        | `romance_scam`     | 0.97 | US      | 500 | [US] My mom thinks she's dating Steve Perry from Journey.              |
| 41845        | `sextortion`       | 0.88 | —       | 500 | [SG/PH] Found a Sextortion scam; having second thoughts and slightly c |
| 42050        | `sextortion`       | 0.88 | —       | 500 | My friend fall into a scam and they using a suicide threat + FBI inclu |
| 42226        | `sextortion`       | 0.82 | —       | 500 | Targeted by an STI scanning/pregnancy extortion scammer                |
| 42052        | `shopping_scam`    | 0.90 | US      | 500 | Theshiestyproof.com Scammer [US]                                       |
| 42083        | `shopping_scam`    | 0.60 | —       | 500 | Chinese gem certificates, legit or not?                                |
| 42190        | `shopping_scam`    | 0.78 | DE      | 500 | [DE] Ebay: Different buyers asking for extra fast shipping on my aucti |
| 41428        | `sms_scam`         | 0.75 | —       | 500 | Is this bank of america text a scam?                                   |
| 41637        | `sms_scam`         | 0.55 | —       | 500 | Why are these spam texts so annoying?                                  |
| 41779        | `sms_scam`         | 0.65 | —       | 461 | Is this a text from OnePay a scam?                                     |
| 34064        | `tech_support`     | 0.90 | —       | 500 | Almost fell for a fake Google support scam                             |
| 40991        | `tech_support`     | 0.88 | US      | 500 | [US] Shop App gave me this notification, how to proceed a              |
| 41145        | `tech_support`     | 0.88 | US      | 500 | [US] ZOHO Booking app Scam!!!!                                         |

## Distribution

| Label              | n   |     | Label           | n   |
| ------------------ | --- | --- | --------------- | --- |
| `advance_fee`      | 3   |     | `phishing`      | 3   |
| `email_scam`       | 3   |     | `phone_scam`    | 3   |
| `employment_scam`  | 3   |     | `rental_scam`   | 3   |
| `impersonation`    | 3   |     | `romance_scam`  | 3   |
| `informational`    | 4   |     | `sextortion`    | 3   |
| `investment_fraud` | 3   |     | `shopping_scam` | 3   |
| `other`            | 4   |     | `sms_scam`      | 3   |
|                    |     |     | `tech_support`  | 3   |

Country spread reflects the corpus: mostly US/unlabelled, which is the point — the takes must be
useful on global patterns, with the Australian angle as a translation layer (`DECISIONS.md` X2).
