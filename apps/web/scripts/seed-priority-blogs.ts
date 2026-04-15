/**
 * Seed 3 high-priority blog posts: SPF compliance, PayID scams, Facebook Marketplace safety.
 *
 * Usage: npx tsx apps/web/scripts/seed-priority-blogs.ts
 *
 * Posts are inserted as status: "published" with published_at = NOW().
 * Uses ON CONFLICT (slug) DO UPDATE to be safely re-runnable.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Ensure "compliance" category exists
// ---------------------------------------------------------------------------
async function ensureCategoryExists(
  slug: string,
  name: string,
  description: string,
  sortOrder: number
): Promise<void> {
  const { data } = await supabase
    .from("blog_categories")
    .select("slug")
    .eq("slug", slug)
    .single();

  if (!data) {
    const { error } = await supabase.from("blog_categories").insert({
      name,
      slug,
      description,
      sort_order: sortOrder,
    });
    if (error) {
      console.error(`  ERROR creating category "${slug}":`, error.message);
    } else {
      console.log(`  Created category: ${slug}`);
    }
  } else {
    console.log(`  Category "${slug}" already exists`);
  }
}

// ---------------------------------------------------------------------------
// Post content
// ---------------------------------------------------------------------------

const POST_1_CONTENT = `The Scams Prevention Framework Act 2025 is Australia's most significant consumer protection legislation in a generation. Receiving Royal Assent on 21 February 2025, the SPF amends the Competition and Consumer Act 2010 to create legally enforceable obligations for banks, telecommunications providers, and digital platforms — with penalties that dwarf anything the ACCC has wielded before.

If your organisation falls within one of these three sectors, this guide covers everything you need to know before the 1 July 2026 commencement date.

## What Is the Scams Prevention Framework?

The SPF establishes a "whole-of-ecosystem" approach to scam prevention. Rather than placing the burden solely on consumers to detect scams, the framework requires the institutions that facilitate scam communications and scam payments to take active responsibility for preventing, detecting, and disrupting scam activity.

The framework is built on the recognition that scams are a systemic problem. A single scam typically traverses multiple sectors: a scam message originates on a **digital platform**, is delivered via a **telecommunications network**, and results in a payment through a **bank**. The SPF creates obligations at every link in this chain.

> [!WARNING]
> **Commencement date: 1 July 2026.** Sector designation instruments were consulted between 28 November 2025 and 5 January 2026. The overarching principles apply first, with sector-specific codes to follow. Entities that are not prepared by July 2026 face immediate compliance risk.

## The Six Principles

The SPF is structured around six overarching principles that apply to all regulated entities across all three sectors. These principles form the backbone of every compliance obligation.

### 1. Govern

Regulated entities must establish and maintain governance arrangements for scam prevention. This includes:

- Designating a senior officer responsible for scam prevention compliance
- Developing and maintaining a scam prevention strategy
- Conducting regular risk assessments
- Providing annual certification of compliance to the relevant regulator

The Govern principle ensures scam prevention is treated as a board-level responsibility, not an afterthought delegated to a fraud team.

### 2. Prevent

Entities must take reasonable steps to prevent scams from reaching consumers in the first place. The specific obligations vary by sector:

- **Banks**: Consumer warnings at point of transaction, Confirmation of Payee systems, real-time transaction alerts
- **Telcos**: Sender ID verification through the Australian Sender ID Registry, blocking known scam numbers
- **Digital platforms**: Advertiser credential verification, new account verification, removal of scam content

> [!TIP]
> The "Prevent" principle is where most entities will need to invest most heavily. Prevention is cheaper than detection, and regulators have signalled they will look most favourably on entities with robust prevention measures.

### 3. Detect

Entities must implement internal detection mechanisms and consume external Actionable Scam Intelligence (ASI) to identify scam activity. This includes:

- Real-time transaction monitoring algorithms (banks)
- Scam content detection in calls and messages (telcos)
- Automated scanning of advertisements and listings (digital platforms)
- Consuming and acting on ASI from external sources, including third-party threat intelligence feeds

The Detect principle creates direct demand for external scam intelligence providers — entities cannot rely solely on internal detection.

### 4. Report

Regulated entities must report Actionable Scam Intelligence to the ACCC within 24 hours. They must also share intelligence cross-sector to enable coordinated disruption. Key requirements:

- Report confirmed scam indicators (URLs, phone numbers, email addresses, bank accounts) to the ACCC
- Share intelligence with other regulated entities where doing so could prevent consumer harm
- Maintain records of all reports made and received
- Participate in intelligence-sharing arrangements as required by sector codes

### 5. Disrupt

Once a scam is detected, entities must take active steps to disrupt it:

- **Banks**: Delay or block suspicious transactions, freeze mule accounts, recall payments where possible
- **Telcos**: Block confirmed scam numbers, suspend fraudulent sender IDs
- **Digital platforms**: Suspend scam accounts, remove scam content, disable fraudulent advertisements

> [!WARNING]
> **Safe harbour protection (s58BZA):** Entities that act on Actionable Scam Intelligence to disrupt scams are protected from civil liability for disruption actions for up to 28 days. This creates a strong incentive to maintain robust ASI sources — including third-party threat intelligence feeds — and act decisively when scam indicators are received.

### 6. Respond

When a consumer is affected by a scam, entities must:

- Provide an internal dispute resolution process
- Furnish a statement of compliance within 30 days of receiving a scam complaint
- Cooperate with AFCA (Australian Financial Complaints Authority) external dispute resolution
- Participate in cross-sector liability apportionment where a scam traversed multiple entities

> [!TIP]
> The compliance statement required under the Respond principle is admissible in EDR and court proceedings. A false or misleading compliance statement may be referred to the ACCC. Entities should invest in automated compliance documentation that can demonstrate the specific steps taken to prevent, detect, and disrupt each reported scam.

## Obligations by Sector

### Banks and Financial Institutions (ASIC-regulated ADIs)

The banking sector faces the most detailed obligations because banks are typically the final link in the scam chain — where money actually leaves the victim's account.

**Key obligations:**

| Obligation | Detail |
|-----------|--------|
| Confirmation of Payee | Verify payee name matches the account before processing first-time payments |
| Real-time transaction alerts | Notify consumers of unusual or high-risk transactions before completion |
| Suspicious transaction algorithms | Deploy and maintain ML/AI-based transaction monitoring |
| Payment recall | Attempt to recall scam payments within prescribed timeframes |
| Mule account detection | Identify and freeze accounts receiving proceeds of scams |
| ASI consumption | Consume external scam intelligence feeds and integrate into detection systems |
| 24-hour reporting | Report confirmed scam indicators to the ACCC within 24 hours |

**Regulator:** ASIC (Australian Securities and Investments Commission)

### Telecommunications Providers (ACMA-regulated)

Telcos are the delivery mechanism for the majority of scam communications — phone calls, SMS messages, and increasingly, RCS messages.

**Key obligations:**

| Obligation | Detail |
|-----------|--------|
| Scam content monitoring | Monitor calls and messages for scam indicators using automated systems |
| Sender ID verification | Verify sender IDs through the Australian Sender ID Registry |
| Scam number blocking | Block confirmed scam phone numbers and suspend fraudulent sender IDs |
| Call authentication | Implement STIR/SHAKEN or equivalent caller ID authentication |
| ASI sharing | Share confirmed scam phone numbers and sender IDs with other telcos and regulators |

**Regulator:** ACMA (Australian Communications and Media Authority)

### Digital Platforms (ACCC-regulated)

Digital platforms — including social media, online marketplaces, and messaging services — are where many scams originate or are advertised.

**Key obligations:**

| Obligation | Detail |
|-----------|--------|
| Advertiser verification | Verify the identity and credentials of advertisers before publishing ads |
| Account verification | Verify new accounts to prevent creation of scam profiles |
| Scam content removal | Detect and remove scam content, including fraudulent listings and ads |
| Consumer reporting mechanisms | Provide accessible, responsive scam reporting tools for users |
| ASI consumption | Consume external scam intelligence to proactively identify scam content |

**Regulator:** ACCC (Australian Competition and Consumer Commission)

## The Penalty Framework

The SPF introduces a penalty regime that makes non-compliance existentially dangerous for most regulated entities.

> [!WARNING]
> **Tier 1 penalties** (for Prevent, Detect, Disrupt, and Respond violations) reach the **greater of**:
> - ~**A$52.7 million** (159,745 penalty units at the current rate)
> - **Three times the benefit obtained** from the contravention
> - **30% of adjusted turnover** for the relevant period
>
> For a mid-tier bank with $2 billion in annual turnover, this means potential penalties of up to **$600 million** for systemic non-compliance.

### Private Right of Action

The SPF creates a **private right of action** allowing consumers to sue regulated entities directly for damages arising from non-compliance. This creates significant class-action risk, particularly for banks and digital platforms where large numbers of consumers may be affected by a single compliance failure.

### AFCA External Dispute Resolution

The SPF authorises AFCA to hear scam-related complaints from **1 September 2026**, with formal complaint acceptance beginning **1 January 2027**.

Key features of the AFCA scheme:

- **Current compensation cap: $631,500 per claim** (indexed annually)
- AFCA can **name non-compliant businesses** publicly
- AFCA can **apportion liability across multiple entities** where a scam traversed multiple sectors
- Systemic issues identified by AFCA may be referred to regulators for enforcement action

> [!TIP]
> Entities should prepare for AFCA complaints now by establishing robust internal dispute resolution processes and investing in compliance documentation. The compliance statement required within 30 days of a complaint must be accurate — a false or misleading statement is a separate offence.

## Actionable Scam Intelligence (ASI)

Section 58AI of the amended Competition and Consumer Act defines Actionable Scam Intelligence through an objective "reasonable grounds to suspect" test. ASI explicitly includes:

- URLs and domain names
- Email addresses
- Phone numbers
- Social media profiles and account identifiers
- Digital wallet addresses
- Bank account information (BSB and account numbers)

### Third-Party Data Gateways

Critically, the SPF Rules — still being drafted as of early 2026 — will formally authorise **third-party data gateways, portals, or websites** that provide access to ASI. This provision creates a regulatory framework for external threat intelligence providers to serve as authorised ASI sources for regulated entities.

> [!TIP]
> The SPF Rules are still being finalised. Entities should not wait for the final rules to begin sourcing external scam intelligence. The overarching principles require ASI consumption from the commencement date, and early investment in intelligence feeds demonstrates good faith compliance.

## Safe Harbour Provision

Section 58BZA provides safe harbour protection for entities that take disruption actions based on ASI. Key features:

- Protection from civil liability for disruption actions taken in good faith
- Protection lasts for **up to 28 days** from the disruption action
- Applies to actions such as blocking transactions, freezing accounts, suspending numbers, and removing content
- Requires that the action was taken based on ASI that met the "reasonable grounds to suspect" threshold

The safe harbour provision creates a strong incentive for regulated entities to maintain robust, diverse ASI sources — including third-party threat intelligence feeds — and to act decisively when scam indicators are received.

## Compliance Checklist

### For Banks and ADIs

- [ ] Appoint a senior officer responsible for SPF compliance
- [ ] Develop and document a scam prevention strategy
- [ ] Implement Confirmation of Payee verification
- [ ] Deploy real-time transaction monitoring with scam detection algorithms
- [ ] Establish payment recall and mule account detection processes
- [ ] Source external ASI feeds (third-party threat intelligence)
- [ ] Build 24-hour ASI reporting pipeline to the ACCC
- [ ] Establish internal dispute resolution for scam complaints
- [ ] Prepare compliance statement templates (30-day deadline)
- [ ] Train staff on scam identification and escalation procedures
- [ ] Conduct tabletop exercises simulating scam scenarios
- [ ] Register for AFCA scam complaint handling (from 1 September 2026)

### For Telecommunications Providers

- [ ] Appoint a senior officer responsible for SPF compliance
- [ ] Implement automated scam content detection in calls and SMS
- [ ] Register and verify sender IDs through the Australian Sender ID Registry
- [ ] Deploy scam number blocking infrastructure
- [ ] Implement STIR/SHAKEN or equivalent caller authentication
- [ ] Source external ASI feeds for known scam phone numbers
- [ ] Build cross-sector intelligence sharing pipeline
- [ ] Establish internal dispute resolution processes
- [ ] Prepare compliance documentation and reporting templates

### For Digital Platforms

- [ ] Appoint a senior officer responsible for SPF compliance
- [ ] Implement advertiser credential verification
- [ ] Deploy automated scam content detection in listings and ads
- [ ] Build accessible consumer scam reporting tools
- [ ] Establish account verification for new users
- [ ] Source external ASI feeds for known scam URLs, emails, and profiles
- [ ] Build ASI reporting pipeline to the ACCC
- [ ] Establish content removal workflows with audit trails
- [ ] Prepare compliance documentation and dispute resolution processes

## How Ask Arthur Enables SPF Compliance

Ask Arthur's Threat Intelligence API is purpose-built for SPF compliance across all three sectors. Here is how our capabilities map to the framework's requirements:

### Detect

Our Threat API provides real-time access to Actionable Scam Intelligence derived from 16 threat feeds, 5 external enrichment sources (AbuseIPDB, HIBP, crt.sh, Twilio Lookup, URLScan.io), and community-sourced scam reports. ASI entities include URLs, phone numbers, email addresses, IP addresses, and cryptocurrency wallet addresses — all enriched with WHOIS, SSL, and reputation data.

Six API endpoints enable integration into any detection pipeline:

| Endpoint | Use Case |
|----------|----------|
| **Batch Entity Lookup** | Bulk-check URLs, phones, emails, and IPs against the threat database |
| **URL Lookup** | Full enrichment for a specific URL (WHOIS, SSL, reputation, risk score) |
| **Domain Aggregation** | Domain-level threat intelligence with WHOIS data |
| **Threat Trending** | Trending scam types by period and region |
| **Trending URLs** | Most-reported domains with aggregation |
| **Aggregate Statistics** | Platform-wide threat statistics for risk calibration |

### Report

Ask Arthur maintains government-ready data export views aligned with Scamwatch categories. Structured data exports include entity type, risk score, first and last seen timestamps, source feeds, and enrichment data — ready for 24-hour ACCC reporting requirements.

### Disrupt

Entity intelligence with risk scores enables automated blocking decisions. When a URL, phone number, or email address exceeds a configurable risk threshold, your systems can automatically block, flag, or quarantine the associated communication or transaction — protected by the safe harbour provision.

> [!TIP]
> Ask Arthur's Threat API is available in three tiers: Free (25 calls/day for evaluation), Pro ($2,000/month, 100 calls/day), and Enterprise ($5,000-$15,000/month, 5,000 calls/day with dedicated support). Contact hello@askarthur.au for a compliance-focused proof of concept.

## Key Dates Timeline

| Date | Event |
|------|-------|
| **21 February 2025** | SPF Act 2025 receives Royal Assent |
| **28 Nov 2025 – 5 Jan 2026** | Sector designation instrument consultation |
| **1 July 2026** | SPF commences — overarching principles take effect |
| **1 September 2026** | AFCA authorised to hear SPF complaints |
| **1 January 2027** | AFCA begins formally accepting SPF complaints |
| **Mid-2027 (expected)** | Sector-specific codes finalised and enforceable |

> [!WARNING]
> The 1 July 2026 commencement date is less than 3 months away. Entities that have not begun compliance preparation face significant risk. The overarching principles — including Detect, Report, and Disrupt obligations — apply from day one, not when sector codes are finalised.

## Conclusion

The Scams Prevention Framework represents a fundamental shift in how Australia approaches scam prevention. For the first time, the institutions that facilitate scam communications and payments bear legally enforceable obligations to protect consumers — backed by penalties severe enough to command board-level attention.

Compliance is not optional, and the deadline is approaching fast. Entities that invest now in governance frameworks, detection capabilities, and external intelligence sources will be best positioned to meet their obligations, defend against penalties and private actions, and — most importantly — protect their customers from the $2.18 billion annual scam crisis.

---

*Ask Arthur's Threat Intelligence API provides SPF-ready Actionable Scam Intelligence for banks, telcos, and digital platforms. Start a free evaluation at [askarthur.au](https://askarthur.au) or contact hello@askarthur.au for enterprise enquiries.*`;

const POST_2_CONTENT = `PayID scams have become one of Australia's fastest-growing marketplace fraud types. If you buy or sell anything on Facebook Marketplace, Gumtree, or other classifieds platforms, you need to understand how these scams work — because the scripts are polished, the fake emails are convincing, and thousands of Australians are falling for them every month.

## How PayID Scams Work

The scam follows a predictable script. Here is how it typically unfolds when you are selling an item on Facebook Marketplace:

**Step 1: The interested "buyer" messages you.** They express interest in your item and agree to your asking price quickly — often without negotiating. This should be your first red flag.

**Step 2: They suggest PayID for payment.** They say something like: "I'll pay via PayID — can you send me your email or phone number linked to your account?" This part is legitimate — PayID does use email addresses or phone numbers as identifiers.

**Step 3: The "relative will collect" excuse.** The buyer says they cannot pick up the item themselves: *"My brother/friend/partner will come and collect it — I'll send the payment now."*

**Step 4: You receive a fake PayID email.** This is where the scam happens. You receive an email that appears to be from PayID, your bank, or a payment processor. It says the buyer has sent payment, but the funds are "on hold" because you need to upgrade to a "business account" first.

> [!DANGER]
> **Example fake PayID email:**
>
> *Subject: PayID Payment Received — Action Required*
>
> *Dear [Your Name],*
>
> *You have received a payment of $850.00 via PayID from [Buyer Name]. However, as this is a business transaction, the funds cannot be released to your personal account. To receive this payment, you must upgrade to a PayID Business Account by paying a one-time fee of $200.00.*
>
> *Please transfer $200.00 to BSB XXX-XXX Account XXXXXXXX to upgrade your account. Once confirmed, the full payment of $850.00 will be released to your account within 1 hour.*
>
> This email is **entirely fake**. PayID does not send emails. There is no such thing as a "PayID Business Account." The BSB and account number belong to the scammer.

**Step 5: The escalation.** If you hesitate, the scammer (posing as the buyer) may send follow-up messages: *"Have you received the payment? The system says it's waiting for you to upgrade."* The fake "PayID support" email may send reminders. The pressure builds.

**Step 6: The overpayment variant.** In some versions, the fake email claims the buyer "accidentally" sent too much — say $1,200 instead of $850 — and asks you to refund the difference. You send $350 to the scammer. No original payment ever existed.

## The Canonical Scam Messages

These are real examples reported by Australian victims:

> [!DANGER]
> *"Hi, is this still available? I can pay full price via PayID. My mum will come pick it up tomorrow if that's ok?"*
>
> *"I've just sent the payment through PayID. You should get an email confirmation shortly. Let me know when it comes through and I'll organise pickup."*
>
> *"Hey did you get the PayID email? It says you need to upgrade your account to business. I had the same issue when I first started using PayID — it's just a one-time thing. They refund the fee straight away."*

That last message — the reassurance that the scammer "had the same issue" — is a hallmark of this scam. It is designed to normalise the request and overcome your hesitation.

## PayID Never Sends Emails

This is the single most important thing to understand about PayID:

**PayID does not send emails. Ever.**

PayID is a feature of the New Payments Platform (NPP) operated by Australian banks. All PayID communications happen exclusively through your banking app or internet banking portal. There is no "PayID support team." There is no "PayID business account." There is no email notification system.

If you receive an email claiming to be from PayID, it is a scam. Full stop.

> [!TIP]
> **How to verify a PayID payment:** Open your banking app and check your transaction history. If the money is there, it is there. If it is not in your account, no payment has been made. Never rely on email "confirmations" — only trust what your banking app shows.

## Red Flags Checklist

Use this checklist when selling on Facebook Marketplace:

- **Non-bank email addresses** — emails from payid-support@gmail.com, payid.australia@outlook.com, or any address that is not your bank's official domain
- **"Business account" or "upgrade" requests** — PayID has no account tiers and no upgrade fees
- **"Overpayment" refund requests** — the buyer claims to have sent too much and asks you to refund the difference
- **Off-platform communication** — the buyer insists on moving to email, WhatsApp, or text instead of Marketplace Messenger
- **Urgency about collection** — "My friend is on the way now, have you received the payment?"
- **Too-quick agreement** — buyer agrees to full asking price instantly with no questions about the item
- **Third-party collection** — "Someone else will pick it up" removes the buyer from the physical transaction
- **Reluctance to meet in person** — legitimate buyers generally want to inspect items before paying

## What to Do If You Are Targeted

If you receive a suspicious PayID email or believe you are being scammed on Facebook Marketplace:

### 1. Do Not Send Any Money

No matter how convincing the email looks, do not transfer any money. There is no fee required to receive a PayID payment. Your bank will never ask you to send money to receive money.

### 2. Check Your Banking App

Open your actual banking app and check your transaction history. If no payment appears, no payment was made. The email is fake.

### 3. Report to Scamwatch

Report the scam to the ACCC's Scamwatch service:
- **Online:** scamwatch.gov.au
- **Phone:** 1300 795 995

### 4. Report to Your Bank

Contact your bank's fraud team, especially if you have already transferred money. The sooner you report, the better the chance of recovering funds.

- Commonwealth Bank: 13 22 21
- Westpac: 1300 131 372
- ANZ: 13 33 50
- NAB: 13 22 65

### 5. Report on Facebook

Report the buyer's profile on Facebook Marketplace. Tap the three dots on their profile or listing and select "Report." This helps Facebook identify and remove scam accounts.

### 6. Block the Scammer

Block the buyer on Marketplace and any other platforms they have contacted you on. Do not engage further — scammers sometimes try "recovery scams" where they contact you again claiming to help you get your money back.

## How Ask Arthur Detects PayID Scams

Ask Arthur's Chrome extension includes real-time PayID scam pattern detection specifically designed for Facebook Marketplace:

- **Chat scanning:** The extension monitors Messenger conversations for PayID scam patterns — including the "business account upgrade" script, overpayment claims, and off-platform communication attempts
- **Seller trust scoring:** When you view a Marketplace listing, the extension analyses the seller's profile age, ratings, location consistency, and listing history to generate a trust score
- **Warning banners:** If a scam pattern is detected in a conversation, the extension displays a clear warning banner directly in the chat window
- **Instant verification:** Right-click any suspicious message and select "Check with Ask Arthur" for immediate AI-powered analysis

> [!TIP]
> Install the Ask Arthur Chrome extension at [askarthur.au](https://askarthur.au) to get real-time protection while browsing Facebook Marketplace. It's free and works automatically in the background.

## Frequently Asked Questions

### Does PayID send emails?

**No.** PayID does not have an email notification system. All PayID communications happen exclusively through your banking app. Any email claiming to be from PayID is a scam.

### Can you get scammed through PayID?

PayID itself is a secure payment system operated by Australian banks. You cannot get scammed *through* PayID — but scammers use the PayID name in fake emails and messages to trick people into sending money. The scam relies on social engineering, not a technical vulnerability in PayID.

### How do I report a PayID scam?

Report to Scamwatch (scamwatch.gov.au or 1300 795 995), your bank's fraud team, and the platform where the scam occurred (e.g., Facebook Marketplace). If you have lost money, contact your bank immediately — early reporting gives the best chance of recovery.

### Is it safe to give someone my PayID?

Your PayID is typically your email address or phone number. Giving someone your PayID so they can send you a payment is generally safe — it does not give them access to your bank account. However, be cautious about sharing it with strangers, and never send money to "receive" a PayID payment.

### What is a "PayID business account"?

**There is no such thing.** PayID does not have different account tiers. Any message asking you to upgrade to a "business account" or pay a fee to receive a payment is a scam.

---

*Ask Arthur is Australia's free scam detection platform. Check any suspicious message at [askarthur.au](https://askarthur.au) or install the Chrome extension for real-time Facebook Marketplace protection.*`;

const POST_3_CONTENT = `Facebook Marketplace has become Australia's go-to platform for buying and selling secondhand goods. But with over 1 billion monthly Marketplace users globally, scammers have followed the crowd. In 2025, Scamwatch received 9,628 reports of buying and selling scams — many originating on Facebook Marketplace.

This guide covers the most common Marketplace scams, how to verify sellers, and what to do if something goes wrong.

## Types of Facebook Marketplace Scams

### 1. Fake Listings

Scammers post attractive items at below-market prices to generate interest quickly. The listing typically uses stolen photos from legitimate sellers or product websites. Once you express interest, the scammer asks for a deposit or full payment before "shipping" the item — which never arrives.

**Common fake listing categories:**
- Electronics (iPhones, gaming consoles, laptops)
- Vehicles (cars, motorcycles, caravans)
- Furniture (particularly designer or high-value pieces)
- Event tickets (concerts, sports, festivals)
- Rental properties (fake listings for real addresses)

> [!TIP]
> **Reverse image search** any listing photo by saving it and uploading to Google Images (images.google.com). If the same photo appears on other listings or product websites, it is likely stolen.

### 2. PayID and Payment Scams

The buyer or seller manipulates the payment process. The most common variant involves fake PayID "confirmation" emails that ask you to pay an "upgrade fee" to receive funds. See our detailed guide: [PayID Scams on Facebook Marketplace](/blog/payid-scams-facebook-marketplace-guide).

Other payment scam variants include:
- **Overpayment scams** — buyer "accidentally" sends too much and asks for a refund of the difference (no payment was ever made)
- **Fake bank transfer screenshots** — buyer shows a doctored screenshot of a "pending transfer" and asks you to release the item before the transfer clears
- **Escrow scams** — buyer suggests using a fake "escrow service" website that steals your payment

### 3. Shipping Scams

Scammers insist on shipping items rather than meeting in person, then:
- Send an empty box or worthless item
- Provide a fake tracking number
- Claim the item was "lost in transit" after receiving payment
- Ask you to use a specific (fake) shipping service

> [!WARNING]
> Facebook Marketplace was designed for local, in-person transactions. Any buyer or seller who insists on shipping — particularly interstate — should be treated with caution. If you cannot inspect the item in person, the risk increases significantly.

### 4. Identity Verification Scams

The buyer or seller asks you to "verify your identity" before proceeding with the transaction. They send a link to a fake verification website that harvests your personal information — name, address, date of birth, driver's licence, and sometimes banking details.

No legitimate Marketplace transaction requires identity verification through a third-party website.

### 5. Counterfeit Goods

Designer clothing, electronics, beauty products, and branded accessories sold at suspiciously low prices are often counterfeit. The seller may claim they are "unwanted gifts," "ex-display," or from a "liquidation sale."

## How to Check a Seller

Before committing to a purchase, investigate the seller's profile:

### Account Age

- **Click the seller's name** on the listing to view their profile
- **Check when they joined Facebook** — new accounts (created within the last few months) are higher risk
- **Look at their profile completeness** — do they have a profile photo, cover photo, and personal information?

> [!TIP]
> Scam accounts are typically created recently, have few friends, minimal post history, and generic profile photos. A legitimate seller usually has a well-established personal profile.

### Ratings and Reviews

- Check the seller's **Marketplace rating** (star rating and review count)
- Read individual reviews — look for patterns of complaints
- Be cautious of sellers with no ratings at all (new to Marketplace)
- Also be wary of sellers with suspiciously perfect ratings and generic review text

### Listing History

- View the seller's other Marketplace listings
- **Red flag:** Multiple high-value items listed simultaneously at below-market prices
- **Red flag:** Listings across multiple, unrelated categories (electronics, furniture, vehicles, clothing all at once)
- **Green flag:** A seller with a history of selling similar items over time

### Location Match

- Does the seller's listed location match the item pickup location?
- Are they claiming to be local but want to ship the item?
- Is the pickup address in a public location rather than a residential address?

## Price: Too Good to Be True?

Scammers price items low to generate quick interest and discourage careful thinking. Use these benchmarks:

| Item Category | Suspicious Price | Why |
|--------------|-----------------|-----|
| iPhone (recent model) | 40%+ below retail | Even secondhand iPhones hold value well |
| Gaming consoles | 50%+ below retail | High demand keeps prices stable |
| Designer clothing/bags | 70%+ below retail | Likely counterfeit |
| Vehicles | 30%+ below market value | If it seems too cheap, it is |
| Event tickets | Face value from a stranger | High counterfeit risk |
| Rental properties | 30%+ below comparable rents | Rental scams are epidemic |

> [!WARNING]
> If a price seems too good to be true, it almost certainly is. Scammers rely on the excitement of a "great deal" to override your caution. Always ask yourself: *"Why would someone sell this item for so much less than it's worth?"*

## Red Flags in Buyer/Seller Messages

Watch for these patterns in Marketplace Messenger conversations:

**From sellers:**
- Refusing to meet in person or show the item before payment
- Insisting on payment before you see the item
- Providing excuses for why the item cannot be inspected ("I'm moving interstate," "it's in storage")
- Asking you to communicate off-platform (email, WhatsApp, text)
- Pressuring you to decide quickly ("someone else is interested")

**From buyers:**
- Agreeing to your asking price immediately without questions
- Suggesting a "friend" or "relative" will collect the item
- Asking to pay via unusual methods
- Sending "proof of payment" emails rather than waiting for your bank to confirm
- Requesting your email address "for PayID" (PayID uses email but all notifications come through your banking app, not email)

## Safe Payment Methods

| Method | Safety Level | Notes |
|--------|-------------|-------|
| **Cash on pickup** | Safest | Meet in a public place; count the cash before handing over the item |
| **Bank transfer (verified)** | Safe | Wait for funds to actually appear in your account — not an email confirmation |
| **PayID** | Safe (if used correctly) | Verify payment in your banking app, not via email |
| **PayPal Goods & Services** | Moderate | Offers buyer protection but higher fees; beware of PayPal phishing emails |
| **Gift cards** | Unsafe | Never accept or send gift cards as payment — this is always a scam |
| **Cryptocurrency** | Unsafe | Irreversible; no consumer protection; commonly used in scams |
| **Wire transfer (Western Union, MoneyGram)** | Unsafe | Irreversible; a hallmark of scam payment requests |

> [!TIP]
> For in-person transactions, **cash is king**. Meet at a well-lit public location (shopping centre, police station car park), bring a friend, and only hand over the item once you have counted the cash or confirmed the bank transfer in your own banking app.

## How to Report Scams

### Report to Facebook

1. Open the listing or conversation
2. Tap the three dots (⋯) menu
3. Select **"Report"**
4. Follow the prompts to categorise the scam
5. Block the scammer's profile

### Report to Scamwatch

- **Online:** scamwatch.gov.au
- **Phone:** 1300 795 995
- Include screenshots, the seller's profile link, and any payment details

### Report to Your Bank

If you have transferred money:
- Contact your bank's fraud team immediately
- Request a recall of the payment
- The sooner you report, the better the chance of recovery

### Report to Police

For significant losses, file a report with your state police:
- **NSW:** Police Assistance Line — 131 444
- **VIC:** Crime Stoppers — 1800 333 000
- **QLD:** Policelink — 131 444
- **WA:** Police — 131 444
- **SA:** Police — 131 444

## How Ask Arthur's Extension Helps

The Ask Arthur Chrome extension provides real-time protection while you browse Facebook Marketplace:

### Seller Trust Badges

When you view a listing, the extension analyses the seller's profile and displays a trust badge:
- **Green badge:** Established account, positive history, consistent location
- **Amber badge:** Some risk indicators detected (new account, no ratings, location mismatch)
- **Red badge:** Multiple risk indicators detected — proceed with extreme caution

### Chat Scanning

The extension monitors your Messenger conversations for scam patterns in real time:
- PayID "business account upgrade" scripts
- Overpayment refund requests
- Off-platform communication attempts
- Pressure tactics and urgency language

### PayID Pattern Detection

Specifically trained on Australian PayID scam scripts, the extension detects:
- Fake PayID email references in chat
- "Business account" and "upgrade fee" language
- Third-party collection arrangements combined with PayID payment requests

> [!TIP]
> The Ask Arthur extension works silently in the background. You do not need to activate it — it automatically scans Marketplace listings and Messenger conversations and only alerts you when it detects something suspicious. Install it free at [askarthur.au](https://askarthur.au).

## Frequently Asked Questions

### How do I know if a Facebook Marketplace listing is real?

Check the seller's account age, ratings, listing history, and whether they are willing to meet in person. Use reverse image search on listing photos. If the price is significantly below market value, treat it as suspicious. Use Ask Arthur's Chrome extension for automated trust scoring.

### What is the safest way to pay on Facebook Marketplace?

Cash on pickup in a public location is the safest method. If using bank transfer or PayID, verify the payment in your banking app — never rely on email "confirmations." Avoid gift cards, cryptocurrency, and wire transfers.

### Can I get my money back if I am scammed on Facebook Marketplace?

Contact your bank immediately — the sooner you report, the better. Bank transfers may be recoverable if reported quickly. PayPal Goods & Services offers buyer protection. Cash, gift cards, cryptocurrency, and wire transfers are generally not recoverable. Report to Scamwatch regardless.

### Does Facebook protect buyers on Marketplace?

Facebook offers limited purchase protection for items bought with Facebook Checkout (shipping transactions). For local pickup transactions paid outside Facebook's system, there is no buyer protection from Facebook. This is why in-person, cash transactions are recommended.

### How do I report a scammer on Facebook Marketplace?

Open the scammer's listing or profile, tap the three dots menu, select "Report," and follow the prompts. Also report to Scamwatch (scamwatch.gov.au) and your bank if money was lost.

---

*Ask Arthur is Australia's free scam detection platform. Install the Chrome extension for real-time Facebook Marketplace protection, or check any suspicious message at [askarthur.au](https://askarthur.au).*`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  category_slug: string;
  hero_image_url: string | null;
  status: string;
  is_featured: boolean;
  seo_title: string;
  meta_description: string;
  reading_time_minutes: number;
  published_at: string;
}

const posts: BlogPost[] = [
  {
    slug: "scams-prevention-framework-compliance-guide",
    title:
      "Scams Prevention Framework: What Australian Banks, Telcos, and Platforms Must Do by July 2026",
    subtitle:
      "A comprehensive compliance guide to the SPF Act 2025 — obligations, penalties, and how to prepare before the deadline.",
    excerpt:
      "The SPF Act 2025 commences 1 July 2026 with penalties up to $52.7M. This guide covers the six principles, sector obligations, penalty framework, and compliance checklists for banks, telcos, and digital platforms.",
    content: POST_1_CONTENT,
    author: "Brendan Milton",
    tags: [
      "spf",
      "compliance",
      "regulation",
      "banks",
      "telcos",
      "digital-platforms",
      "australia",
    ],
    category_slug: "compliance",
    hero_image_url: null,
    status: "published",
    is_featured: true,
    seo_title: "SPF Compliance Guide 2026: What Banks, Telcos & Platforms Must Do",
    meta_description:
      "Complete guide to Scams Prevention Framework Act 2025 compliance. Obligations, penalties up to $52.7M, and how to prepare before 1 July 2026.",
    reading_time_minutes: 13,
    published_at: new Date().toISOString(),
  },
  {
    slug: "payid-scams-facebook-marketplace-guide",
    title:
      "PayID Scams on Facebook Marketplace: The Complete Guide to Staying Safe",
    subtitle:
      "How PayID scams work, the exact scripts scammers use, and how to protect yourself when buying and selling online.",
    excerpt:
      "PayID scams are Australia's fastest-growing marketplace fraud. Learn the full scam script, why PayID never sends emails, red flags to watch for, and what to do if you are targeted.",
    content: POST_2_CONTENT,
    author: "Brendan Milton",
    tags: [
      "payid",
      "facebook-marketplace",
      "scam",
      "payment-scam",
      "australia",
    ],
    category_slug: "scam-alerts",
    hero_image_url: null,
    status: "published",
    is_featured: false,
    seo_title: "PayID Scams on Facebook Marketplace: How to Stay Safe in 2026",
    meta_description:
      "PayID scams are Australia's fastest-growing marketplace fraud. Learn the exact scripts scammers use and how to protect yourself.",
    reading_time_minutes: 8,
    published_at: new Date().toISOString(),
  },
  {
    slug: "facebook-marketplace-scam-check-guide",
    title:
      "Is That Facebook Marketplace Listing a Scam? How to Check Before You Buy",
    subtitle:
      "A practical guide to spotting fake listings, verifying sellers, and staying safe on Facebook Marketplace.",
    excerpt:
      "9,628 buying/selling scam reports in 2025. Learn how to spot fake Facebook Marketplace listings, verify sellers, use safe payment methods, and protect yourself from the most common Marketplace scams.",
    content: POST_3_CONTENT,
    author: "Brendan Milton",
    tags: [
      "facebook-marketplace",
      "buying-scams",
      "seller-verification",
      "australia",
    ],
    category_slug: "guides",
    hero_image_url: null,
    status: "published",
    is_featured: false,
    seo_title:
      "Facebook Marketplace Scams: How to Check if a Listing is Legit",
    meta_description:
      "9,628 buying/selling scam reports in 2025. Learn how to spot fake Facebook Marketplace listings and protect yourself from fraud.",
    reading_time_minutes: 9,
    published_at: new Date().toISOString(),
  },
];

async function main() {
  console.log("Seeding 3 high-priority blog posts...\n");

  // Ensure "compliance" category exists (others already seeded in v18)
  await ensureCategoryExists(
    "compliance",
    "Compliance",
    "Regulatory compliance guides for the Scams Prevention Framework and Australian consumer protection law",
    5
  );

  let upserted = 0;

  for (const post of posts) {
    // Upsert: insert or update on slug conflict
    const { error } = await supabase.from("blog_posts").upsert(
      {
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        excerpt: post.excerpt,
        content: post.content,
        author: post.author,
        tags: post.tags,
        category_slug: post.category_slug,
        hero_image_url: post.hero_image_url,
        status: post.status,
        is_featured: post.is_featured,
        seo_title: post.seo_title,
        meta_description: post.meta_description,
        reading_time_minutes: post.reading_time_minutes,
        published_at: post.published_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    );

    if (error) {
      console.error(`  ERROR upserting "${post.title}":`, error.message);
    } else {
      console.log(`  OK: "${post.title}"`);
      upserted++;
    }
  }

  console.log(`\nDone: ${upserted} posts upserted as published.`);
  console.log("View at /blog on the web app.");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
