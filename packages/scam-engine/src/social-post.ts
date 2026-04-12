// Generate draft social media posts for brand impersonation alerts.
// Short version (Twitter 280 chars) + long version (LinkedIn/Facebook).

// Brand handles on Twitter for tagging
const BRAND_HANDLES: Record<string, string> = {
  "Google": "@Google",
  "ANZ": "@ANZ_AU",
  "Commonwealth Bank": "@CommBank",
  "Westpac": "@Westpac",
  "NAB": "@NAB",
  "Telstra": "@Telstra",
  "Optus": "@Optus",
  "myGov": "@ServicesGovAU",
  "Australia Post": "@ausaborpost",
  "ATO": "@ato_gov_au",
  "Amazon": "@AmazonAU",
  "Netflix": "@NetflixANZ",
  "PayPal": "@PayPalAU",
  "Apple": "@Apple",
  "Microsoft": "@Microsoft",
};

export interface DraftPostInput {
  brandName: string;
  scamType?: string | null;
  channel?: string | null;
  summary?: string | null;
  scammerPhones?: string[];
  scammerUrls?: string[];
}

export interface DraftPosts {
  short: string;  // Twitter (max 280)
  long: string;   // LinkedIn / Facebook
}

function getDeliveryLabel(channel: string | null | undefined): string {
  switch (channel) {
    case "sms": return "SMS";
    case "email": return "email";
    case "phone": return "phone call";
    case "social": return "social media";
    case "website": return "website";
    default: return "message";
  }
}

function getBrandHandle(brandName: string): string {
  return BRAND_HANDLES[brandName] || brandName;
}

function sanitiseForPost(text: string): string {
  // Remove PII placeholders and clean up
  return text
    .replace(/\[EMAIL\]/g, "")
    .replace(/\[PHONE\]/g, "")
    .replace(/\[NAME\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateDraftPosts(input: DraftPostInput): DraftPosts {
  const handle = getBrandHandle(input.brandName);
  const delivery = getDeliveryLabel(input.channel);
  const summaryClean = input.summary ? sanitiseForPost(input.summary) : "";

  // Short version (Twitter — max 280 chars)
  const shortBase = `🚨 Scam Alert: Active ${delivery} scam impersonating ${handle} targeting Australians.\n\n🔍 Verify suspicious messages free at askarthur.au\n\n#ScamAlert #AskArthur #Australia`;

  // If short enough, add a 1-line summary
  const summaryOneLiner = summaryClean.length > 80
    ? summaryClean.slice(0, 77) + "..."
    : summaryClean;

  let short: string;
  const withSummary = `🚨 Scam Alert: Active ${delivery} scam impersonating ${handle} targeting Australians.\n\n⚠️ ${summaryOneLiner}\n\n🔍 Verify at askarthur.au\n\n#ScamAlert #AskArthur`;

  if (withSummary.length <= 280 && summaryOneLiner) {
    short = withSummary;
  } else {
    short = shortBase.length <= 280 ? shortBase : shortBase.slice(0, 277) + "...";
  }

  // Long version (LinkedIn / Facebook)
  const scammerInfo: string[] = [];
  if (input.scammerPhones?.length) {
    scammerInfo.push(`Scammer phone numbers detected: ${input.scammerPhones.slice(0, 3).join(", ")}`);
  }
  if (input.scammerUrls?.length) {
    scammerInfo.push(`Suspicious URLs: ${input.scammerUrls.slice(0, 3).join(", ")}`);
  }

  const long = [
    `🚨 Scam Alert: We've detected an active ${delivery} scam impersonating ${input.brandName} targeting Australian consumers.`,
    "",
    summaryClean ? `⚠️ ${summaryClean}` : "",
    "",
    ...scammerInfo,
    "",
    "What to do if you received this:",
    "• Do NOT click any links or call numbers shown",
    "• Do NOT provide personal or financial information",
    `• Visit the official ${input.brandName} website directly`,
    "• Report to Scamwatch: scamwatch.gov.au",
    "",
    `🔍 Check any suspicious message instantly and free at askarthur.au`,
    "",
    `Ask Arthur is an AI-powered scam detection tool protecting Australians from fraud. We detected this campaign through our real-time threat intelligence pipeline.`,
    "",
    "#ScamAlert #CyberSecurity #Australia #ScamPrevention #AskArthur",
  ].filter(Boolean).join("\n");

  return { short, long };
}
