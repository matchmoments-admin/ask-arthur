/**
 * One-time script to seed SEO-targeted blog posts as drafts.
 * Targets high-search-volume Australian scam queries.
 *
 * Usage: npx tsx apps/web/scripts/seed-seo-blogs.ts
 *
 * Posts are inserted as status: "draft" for review before publishing.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface SeedPost {
  slug: string;
  title: string;
  seo_title: string;
  meta_description: string;
  excerpt: string;
  content: string;
  category_slug: string;
  tags: string[];
  reading_time_minutes: number;
}

const posts: SeedPost[] = [
  {
    slug: "how-to-spot-ato-scam-calls-and-texts",
    title: "How to Spot ATO Scam Calls and Text Messages",
    seo_title: "ATO Scam Calls & Texts: How to Spot Them (2026 Guide)",
    meta_description:
      "Learn how to identify fake ATO scam calls and text messages targeting Australians. Real ATO contact methods, red flags to watch for, and what to do if you receive one.",
    excerpt:
      "The ATO is one of the most impersonated organisations in Australia. Here's how to tell if that call or text is really from the Tax Office.",
    category_slug: "scam-alerts",
    tags: ["ato", "tax-scam", "phone-scam", "sms-scam", "australia"],
    reading_time_minutes: 5,
    content: `Scammers impersonating the Australian Taxation Office (ATO) are responsible for millions of dollars in losses every year. These scams come via phone calls, text messages, and emails — and they're getting more sophisticated.

## How ATO Scams Work

Scammers contact you claiming to be from the ATO. They typically:

- Claim you owe a tax debt that must be paid immediately
- Threaten arrest, deportation, or legal action
- Demand payment via gift cards, cryptocurrency, or bank transfer
- Ask for your Tax File Number (TFN) or banking details
- Spoof the ATO's real phone number on caller ID

## Red Flags to Watch For

> [!WARNING]
> The real ATO will **never** threaten you with immediate arrest, demand payment via gift cards or cryptocurrency, or ask you to pay a debt to a personal bank account.

- **Urgency and threats**: "Pay now or face arrest" is always a scam
- **Unusual payment methods**: Gift cards, crypto, wire transfers
- **Unsolicited contact**: The ATO sends correspondence via myGov first
- **Requests for personal info**: The ATO won't cold-call asking for your TFN

## How the Real ATO Contacts You

The ATO primarily communicates through:

1. **myGov inbox** — secure online messages
2. **Registered post** — official letters
3. **Phone calls** — but they'll never demand immediate payment or threaten arrest

> [!TIP]
> If you receive a suspicious call claiming to be from the ATO, hang up and call the ATO directly on **13 28 61** to verify.

## What to Do If You Receive an ATO Scam

1. **Don't engage** — Hang up or don't reply to the text
2. **Don't share personal information** — Never give your TFN, bank details, or passwords
3. **Report it** — Forward scam texts to the ATO at 0427 225 427
4. **Report to Scamwatch** — Visit scamwatch.gov.au or call **1300 795 995**
5. **Check with Ask Arthur** — Paste the message into our checker at askarthur.au for instant AI analysis

## Common ATO Scam Messages

These are examples of known scam patterns:

- "ATO: You have an outstanding tax debt of $X. Pay within 24 hours to avoid legal action."
- "Your tax refund of $X is pending. Verify your details to receive payment."
- "ATO Notice: Suspicious activity detected on your tax account. Call immediately."

Every one of these is a scam. The ATO does not communicate urgent tax matters via text message.`,
  },
  {
    slug: "is-that-mygov-email-real-how-to-check",
    title: "Is That myGov Email Real? How to Check",
    seo_title: "Is That myGov Email Real? How to Spot Fake myGov Emails",
    meta_description:
      "Receiving a suspicious myGov email? Learn how to tell real myGov emails from scam phishing attempts. Includes official myGov contact details and red flags.",
    excerpt:
      "myGov phishing emails are among the most common scams in Australia. Here's how to check if that email is legitimate.",
    category_slug: "scam-alerts",
    tags: ["mygov", "phishing", "email-scam", "australia"],
    reading_time_minutes: 4,
    content: `Fake myGov emails are one of the top phishing scams in Australia. Scammers create convincing replicas of myGov communications to steal your login credentials and personal information.

## How myGov Phishing Works

You receive an email that looks like it's from myGov. It typically asks you to:

- "Verify your identity" by clicking a link
- "Update your payment details" for a Centrelink or Medicare payment
- "Confirm your account" to avoid suspension
- "Claim a refund" by entering your banking details

The link takes you to a fake myGov login page that captures your credentials.

## Red Flags in Fake myGov Emails

> [!WARNING]
> myGov will **never** send you an email asking you to click a link to log in, enter your password, or provide banking details.

- **Links to log in**: Real myGov emails tell you to log in directly at my.gov.au
- **Urgency**: "Your account will be suspended in 24 hours"
- **Sender address**: Check carefully — scammers use addresses like mygov-au.com or mygov.support
- **Grammar and spelling errors**: Official communications are carefully proofread
- **Generic greetings**: "Dear Customer" instead of your name

## How Real myGov Communicates

myGov only sends emails to notify you that you have a new message in your myGov inbox. These emails:

1. **Never contain links to log in** — they tell you to visit my.gov.au directly
2. **Never ask for personal information**
3. **Come from** noreply@my.gov.au

> [!TIP]
> Always navigate to myGov by typing **my.gov.au** directly into your browser. Never click links in emails claiming to be from myGov.

## What to Do If You Receive a Suspicious myGov Email

1. **Don't click any links** in the email
2. **Check your myGov inbox** — log in directly at my.gov.au
3. **Report the email** — forward it to scams@servicesaustralia.gov.au
4. **Report to Scamwatch** — Visit scamwatch.gov.au or call **1300 795 995**
5. **Use Ask Arthur** — Paste the email content into askarthur.au for instant analysis

## If You've Already Clicked a Link

If you've entered your credentials on a fake site:

1. **Change your myGov password immediately** at my.gov.au
2. **Enable multi-factor authentication** in your myGov settings
3. **Contact Services Australia** on **136 150** (Centrelink) or **132 011** (Medicare)
4. **Contact IDCARE** on **1800 595 160** for identity theft support
5. **Monitor your bank accounts** for unauthorised transactions`,
  },
  {
    slug: "australia-post-delivery-scam-texts",
    title: "Australia Post Delivery Scam Texts: What to Look For",
    seo_title: "Australia Post Delivery Scam Texts (2026): How to Identify Them",
    meta_description:
      "Getting fake Australia Post delivery texts? Learn how to identify scam SMS messages about parcels, missed deliveries, and customs fees. Report and protect yourself.",
    excerpt:
      "Fake delivery notifications from 'Australia Post' are flooding Australian phones. Here's how to spot them before you click.",
    category_slug: "scam-alerts",
    tags: ["australia-post", "delivery-scam", "sms-scam", "phishing", "australia"],
    reading_time_minutes: 4,
    content: `Fake Australia Post text messages have become one of the most widespread scams in Australia. These messages claim you have a parcel waiting, a delivery that needs rescheduling, or customs fees to pay.

## How Delivery Scam Texts Work

You receive a text message that appears to be from Australia Post. The message typically says:

- "Your parcel could not be delivered. Reschedule here: [link]"
- "Your package is being held due to unpaid customs fees of $X"
- "Track your delivery: [link]"
- "Final attempt: your parcel will be returned if not collected today"

The link leads to a fake website that either steals your personal information or installs malware.

## Red Flags in Fake Delivery Texts

> [!WARNING]
> Australia Post will **never** text you to request payment for customs fees or ask for personal details via SMS. They use official notifications through the AusPost app.

- **Random tracking links**: Real Australia Post links use auspost.com.au
- **Urgency**: "Parcel will be returned within 24 hours"
- **Payment requests**: Asking for credit card details to pay "fees"
- **Short URLs**: bit.ly, tinyurl.com, or unfamiliar domains
- **Generic messages**: No specific parcel details or sender information

## How Real Australia Post Communicates

Australia Post legitimately contacts you through:

1. **The AusPost app** — push notifications with tracking details
2. **Email** — from auspost.com.au with specific tracking numbers
3. **Delivery cards** — physical cards left in your mailbox
4. **SMS** — only if you opted in, from "AusPost" with real tracking numbers

> [!TIP]
> If you receive a delivery text, go directly to **auspost.com.au** and enter the tracking number manually. Never click links in unexpected delivery texts.

## What to Do If You Receive a Fake Delivery Text

1. **Don't click the link** — delete the message
2. **Report the scam SMS** — forward it to **0429 401 703** (Australia Post scam reporting)
3. **Report to Scamwatch** — Visit scamwatch.gov.au or call **1300 795 995**
4. **Check Ask Arthur** — Paste the text into askarthur.au for AI-powered scam analysis

## Protecting Yourself

- Install the official **AusPost app** for legitimate delivery notifications
- Always type web addresses directly into your browser
- Be sceptical of any text asking you to click a link or make a payment
- Keep your phone's operating system and apps updated`,
  },
  {
    slug: "nbn-scam-calls-they-wont-disconnect-you",
    title: "NBN Scam Calls: They Won't Disconnect You",
    seo_title: "NBN Scam Calls: How to Spot Fake NBN Phone Scams (2026)",
    meta_description:
      "Receiving calls claiming your NBN will be disconnected? It's a scam. Learn how to identify fake NBN calls, what the real nbn co does, and how to report these scams.",
    excerpt:
      "Scammers claiming your NBN connection will be disconnected are targeting thousands of Australians. Here's why it's always a scam.",
    category_slug: "scam-alerts",
    tags: ["nbn", "phone-scam", "tech-support-scam", "australia"],
    reading_time_minutes: 4,
    content: `Phone calls claiming your NBN service will be disconnected are one of Australia's most persistent scam types. The callers pretend to be from "NBN Co" or "your internet provider" and try to gain remote access to your computer or steal your banking details.

## How NBN Scam Calls Work

A caller claims to be from NBN Co or your internet service provider. They tell you:

- "Your NBN connection will be disconnected in 24 hours"
- "We've detected a problem with your NBN line"
- "Your IP address has been compromised"
- "We need to run a diagnostic on your computer"

They then ask you to install remote access software (TeamViewer, AnyDesk) or visit a website to "fix" the issue. Once they have access, they can steal your files, install malware, or access your banking.

## Why It's Always a Scam

> [!WARNING]
> NBN Co does **not** make unsolicited phone calls to consumers. NBN Co is a wholesale network provider — they don't have your phone number or account details.

Key facts:
- **NBN Co doesn't contact end users** — your ISP (Telstra, Optus, TPG, etc.) manages your account
- **NBN Co can't disconnect you** — only your ISP can do that
- **No one will call about "line faults"** — the NBN doesn't work that way
- **Tech support will never cold-call you** — legitimate companies don't call unsolicited

## Red Flags

- Automated robocall messages about NBN disconnection
- Callers with heavy accents claiming to be from "the NBN"
- Requests to install remote access software
- Requests for banking details to "verify your account"
- Pressure to act immediately

> [!TIP]
> If someone calls claiming to be from NBN Co or your internet provider, **hang up immediately**. If you're concerned about your internet service, contact your ISP directly using the number on their website.

## What to Do

1. **Hang up** — don't engage with the caller
2. **Never install software** at a caller's request
3. **Never share banking details** over the phone with unsolicited callers
4. **Report to Scamwatch** — Visit scamwatch.gov.au or call **1300 795 995**
5. **Check with Ask Arthur** — Describe the call at askarthur.au for instant analysis

## If You've Given Remote Access

If you allowed a scammer to access your computer:

1. **Disconnect from the internet** immediately
2. **Run a full antivirus scan**
3. **Change all passwords** from a different, clean device
4. **Contact your bank** if you shared any financial information
5. **Contact IDCARE** on **1800 595 160** for support`,
  },
  {
    slug: "toll-road-scam-texts-linkt-etag",
    title: "Toll Road Scam Texts Targeting Linkt and e-TAG Users",
    seo_title: "Linkt & Toll Road Scam Texts: How to Spot Fake Toll Notices",
    meta_description:
      "Getting text messages about unpaid tolls from Linkt or e-TAG? These are likely scams. Learn how to identify fake toll payment texts and protect your information.",
    excerpt:
      "Fake toll road payment texts claiming to be from Linkt or e-TAG are targeting Australian drivers. Here's how to tell they're scams.",
    category_slug: "scam-alerts",
    tags: ["linkt", "toll-scam", "sms-scam", "etag", "australia"],
    reading_time_minutes: 4,
    content: `Scam text messages impersonating toll road operators like Linkt and e-TAG have surged across Australia. These messages claim you have an unpaid toll and direct you to a fake payment page designed to steal your credit card details.

## How Toll Road Scams Work

You receive a text message claiming:

- "You have an unpaid toll of $X. Pay now to avoid penalties: [link]"
- "Your Linkt account has been suspended due to overdue payment"
- "Final notice: unpaid toll fee. Your vehicle registration may be suspended"
- "e-TAG notice: complete payment within 48 hours"

The link leads to a convincing replica of a toll operator's website that captures your payment card details.

## Red Flags

> [!WARNING]
> Linkt and other toll operators will **never** send you a text message with a payment link for unpaid tolls. They send official notices via email and post.

- **Payment links in SMS**: Legitimate toll operators don't text payment links
- **Urgency and threats**: "Registration will be suspended" is not how toll penalties work
- **Small amounts**: Often $4-$12 to seem plausible and not worth questioning
- **Unknown sender numbers**: Real Linkt messages come from verified sender IDs
- **Generic URLs**: Not from linkt.com.au or the official operator domain

## How Real Toll Operators Contact You

Toll operators like Linkt communicate through:

1. **Email** — from verified @linkt.com.au addresses
2. **Postal mail** — official toll notices sent to your registered address
3. **Their app** — push notifications through the Linkt app
4. **Phone** — only from verified numbers, and they'll never ask for card details

> [!TIP]
> If you're unsure about an unpaid toll, log in directly at **linkt.com.au** or call Linkt on **13 33 31**. Never use a link from a text message.

## What to Do

1. **Don't click the link** — delete the text
2. **Check your toll account** — log in directly via the official website
3. **Report the scam** — forward the text to Scamwatch at **0429 401 703**
4. **Report to Scamwatch** — Visit scamwatch.gov.au or call **1300 795 995**
5. **Use Ask Arthur** — Paste the message into askarthur.au for AI-powered analysis

## If You've Already Entered Your Card Details

1. **Contact your bank immediately** — request a card block and replacement
2. **Monitor your statements** for unauthorised transactions
3. **Report to ReportCyber** — Visit cyber.gov.au or call **1300 292 371**`,
  },
  {
    slug: "what-to-do-if-youve-been-scammed-australia",
    title: "What to Do If You've Been Scammed in Australia",
    seo_title: "Scammed in Australia? Here's Exactly What to Do (Step by Step)",
    meta_description:
      "Step-by-step recovery guide for Australians who've been scammed. How to report scams, protect your identity, recover money, and get support. All official contacts included.",
    excerpt:
      "If you've fallen victim to a scam, acting quickly can limit the damage. Here's your step-by-step recovery guide with all the Australian contacts you need.",
    category_slug: "guides",
    tags: ["recovery", "scam-report", "scamwatch", "idcare", "australia"],
    reading_time_minutes: 7,
    content: `Being scammed can feel overwhelming, but acting quickly can significantly reduce the damage. This guide walks you through exactly what to do, step by step, with all the Australian contacts and resources you need.

## Step 1: Stop All Communication

If the scam is ongoing:

- **Stop replying** to messages, emails, or calls from the scammer
- **Block the number or email address**
- **Don't send any more money**, even if threatened

> [!WARNING]
> Scammers often escalate threats when they sense you're pulling away. This is a manipulation tactic. Stop all contact regardless.

## Step 2: Secure Your Finances

If you've shared financial information or sent money:

1. **Contact your bank immediately** — call the number on the back of your card
2. **Request a freeze** on affected accounts
3. **Cancel any pending transfers** if possible
4. **Request new cards** if card details were compromised
5. **Change your internet banking password** from a clean device

> [!TIP]
> Most Australian banks have 24/7 fraud hotlines. Acting within hours gives you the best chance of recovering transferred funds.

**Major bank fraud contacts:**
- Commonwealth Bank: 13 22 21
- Westpac: 1300 131 372
- ANZ: 13 33 50
- NAB: 13 22 65

## Step 3: Secure Your Identity

If you've shared personal documents or information:

1. **Contact IDCARE** on **1800 595 160** — Australia's national identity and cyber support service
2. **Place a ban on your credit file** with all three bureaus:
   - Equifax: equifax.com.au (13 83 32)
   - Illion: illion.com.au
   - Experian: experian.com.au
3. **Change passwords** on all online accounts, especially email and banking
4. **Enable two-factor authentication** on all important accounts
5. **Contact Services Australia** on **136 150** if your myGov or Centrelink details were compromised

## Step 4: Report the Scam

Reporting helps authorities track scam patterns and protect others:

1. **Scamwatch** — scamwatch.gov.au or **1300 795 995** (ACCC)
2. **ReportCyber** — cyber.gov.au or **1300 292 371** (Australian Cyber Security Centre)
3. **Your state police** — if you've lost significant money, file a police report
4. **The platform** — report the scammer's account on the social media or messaging platform used

### Scam-Specific Reporting

| Scam Type | Additional Report To |
|-----------|---------------------|
| Investment scam | ASIC — **1300 300 630** |
| Crypto scam | ASIC — **1300 300 630** |
| Online shopping | ACCC — scamwatch.gov.au |
| Tax/ATO scam | ATO — **13 28 61** |
| Medicare/Centrelink | Services Australia — **136 150** |
| Superannuation | APRA — **1300 558 849** |

## Step 5: Protect Your Devices

If you installed software at a scammer's request or clicked suspicious links:

1. **Disconnect from the internet**
2. **Run a full antivirus scan** (Windows Defender, Malwarebytes, or similar)
3. **Remove any remote access software** (TeamViewer, AnyDesk, etc.)
4. **Update your operating system** and all applications
5. **Change passwords** from a different, clean device

## Step 6: Monitor and Follow Up

In the weeks following a scam:

- **Check bank statements weekly** for unauthorised transactions
- **Monitor your credit report** for applications you didn't make
- **Watch your mail** for unexpected bills or notifications
- **Be alert for follow-up scams** — scammers sell victim lists to other scammers

> [!WARNING]
> "Recovery scams" are common: someone contacts you offering to recover your lost money for a fee. This is always another scam.

## Step 7: Get Support

Being scammed takes an emotional toll. Support is available:

- **Lifeline**: **13 11 14** (24/7 crisis support)
- **Beyond Blue**: **1300 22 4636** (mental health support)
- **IDCARE**: **1800 595 160** (identity theft counselling)
- **Financial Counselling Australia**: **1800 007 007** (free financial counselling)

## Prevention Going Forward

- Use **Ask Arthur** (askarthur.au) to check suspicious messages before responding
- Never share personal information with unsolicited callers
- Enable two-factor authentication on all accounts
- Keep software and devices updated
- Be sceptical of offers that seem too good to be true`,
  },
  {
    slug: "how-to-check-if-a-message-is-a-scam",
    title: "How to Check If a Message Is a Scam",
    seo_title: "Is This Message a Scam? How to Check (Free Australian Tool)",
    meta_description:
      "Not sure if a message is a scam? Learn how to check suspicious texts, emails, and DMs using Ask Arthur's free AI-powered scam detection tool. Works instantly.",
    excerpt:
      "Received a suspicious message and not sure if it's a scam? Here's how to check in seconds using free tools available to all Australians.",
    category_slug: "guides",
    tags: ["how-to", "scam-check", "ask-arthur", "australia"],
    reading_time_minutes: 4,
    content: `We've all received messages that feel "off" — an unexpected text about a parcel delivery, an email from the tax office, a DM from someone claiming to be your bank. The challenge is knowing which ones are real and which are scams.

## The Quick Check: Ask Arthur

The fastest way to check a suspicious message is to paste it into **Ask Arthur** at [askarthur.au](https://askarthur.au).

Here's how it works:

1. **Copy the suspicious message** — select the text from your email, SMS, or messaging app
2. **Paste it into Ask Arthur** — visit askarthur.au and paste the full message
3. **Get an instant verdict** — our AI analyses the message and returns a risk rating

Ask Arthur uses Anthropic's Claude AI combined with threat intelligence databases to identify scam patterns. It checks for known phishing URLs, brand impersonation, urgency tactics, and other red flags.

> [!TIP]
> You can also forward suspicious messages via the Ask Arthur mobile app or browser extension for even faster checking.

## What to Look For Yourself

While AI tools like Ask Arthur can catch most scams, knowing the red flags helps you stay alert:

### 1. Urgency and Pressure
- "Act now or your account will be closed"
- "You have 24 hours to respond"
- "Immediate action required"

Legitimate organisations give you reasonable timeframes and don't threaten immediate consequences.

### 2. Requests for Personal Information
- Passwords, PINs, or security codes
- Tax File Numbers or Medicare numbers
- Banking details or credit card numbers

No legitimate company will ask for sensitive information via text, email, or unsolicited phone call.

### 3. Suspicious Links
- Shortened URLs (bit.ly, tinyurl.com)
- Domains that look similar but aren't right (ato-gov.com instead of ato.gov.au)
- Links with lots of random characters

> [!WARNING]
> Never click links in unexpected messages. Instead, navigate directly to the organisation's official website by typing the address in your browser.

### 4. Too Good to Be True
- "You've won a prize" (that you didn't enter)
- "Earn $5,000 per week working from home"
- "Investment guaranteed to double your money"

If it sounds too good to be true, it is.

### 5. Impersonation Clues
- Generic greetings ("Dear Customer") instead of your name
- Sender address doesn't match the claimed organisation
- Poor grammar or unusual formatting
- Logos or branding that look slightly wrong

## Tools Available to Australians

| Tool | What It Does | Cost |
|------|-------------|------|
| **Ask Arthur** (askarthur.au) | AI-powered scam analysis for text, images, QR codes | Free |
| **Scamwatch** (scamwatch.gov.au) | ACCC scam reporting and alerts | Free |
| **Have I Been Pwned** (haveibeenpwned.com) | Check if your email was in a data breach | Free |
| **Google Safe Browsing** | Built into Chrome — warns about dangerous websites | Free |

## When in Doubt

If you're unsure about a message:

1. **Don't respond** to it
2. **Don't click any links** in it
3. **Check it with Ask Arthur** at askarthur.au
4. **Contact the organisation directly** using their official phone number or website
5. **Report it to Scamwatch** at scamwatch.gov.au

It's always better to take an extra minute to verify than to fall for a scam. Stay safe.`,
  },
];

async function ensureCategoryExists(slug: string): Promise<void> {
  const { data } = await supabase
    .from("blog_categories")
    .select("slug")
    .eq("slug", slug)
    .single();

  if (!data) {
    const name = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    await supabase.from("blog_categories").insert({
      name,
      slug,
      description: `${name} articles`,
      sort_order: 99,
    });
    console.log(`Created category: ${slug}`);
  }
}

async function main() {
  console.log("Seeding SEO blog posts...\n");

  // Ensure required categories exist
  const categories = [...new Set(posts.map((p) => p.category_slug))];
  for (const cat of categories) {
    await ensureCategoryExists(cat);
  }

  let inserted = 0;
  let skipped = 0;

  for (const post of posts) {
    // Check if slug already exists
    const { data: existing } = await supabase
      .from("blog_posts")
      .select("slug")
      .eq("slug", post.slug)
      .single();

    if (existing) {
      console.log(`  SKIP: "${post.title}" (slug already exists)`);
      skipped++;
      continue;
    }

    const { error } = await supabase.from("blog_posts").insert({
      slug: post.slug,
      title: post.title,
      seo_title: post.seo_title,
      meta_description: post.meta_description,
      excerpt: post.excerpt,
      content: post.content,
      category_slug: post.category_slug,
      tags: post.tags,
      reading_time_minutes: post.reading_time_minutes,
      status: "draft",
      author: "Arthur AI",
    });

    if (error) {
      console.error(`  ERROR inserting "${post.title}":`, error.message);
    } else {
      console.log(`  OK: "${post.title}"`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
  console.log("Posts were inserted as drafts. Review and publish at /admin/blog");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
