type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

export interface RecoverySection {
  title: string;
  icon: string;
  items: Array<{
    text: string;
    /** Optional phone number or URL for direct action */
    contact?: string;
    contactLabel?: string;
  }>;
}

export interface RecoverySteps {
  sections: RecoverySection[];
}

const IMMEDIATE_ACTIONS: RecoverySection = {
  title: "Immediate Actions",
  icon: "priority_high",
  items: [
    { text: "Stop all communication with the sender immediately" },
    { text: "Do not click any links or download attachments" },
    {
      text: "If you shared financial details, contact your bank's fraud team now",
    },
    { text: "Take screenshots of the message as evidence before deleting" },
  ],
};

const REPORT_SCAM_AU: RecoverySection = {
  title: "Report the Scam",
  icon: "flag",
  items: [
    {
      text: "Report to Scamwatch (ACCC)",
      contact: "https://www.scamwatch.gov.au/report-a-scam",
      contactLabel: "1300 795 995",
    },
    {
      text: "Report to ReportCyber (ACSC)",
      contact: "https://www.cyber.gov.au/report-and-recover/report",
      contactLabel: "1300 292 371",
    },
    {
      text: "Contact IDCARE for identity theft support",
      contact: "https://www.idcare.org",
      contactLabel: "1800 595 160",
    },
  ],
};

const PROTECT_ACCOUNTS: RecoverySection = {
  title: "Protect Your Accounts",
  icon: "shield",
  items: [
    { text: "Change passwords on any accounts you mentioned or that may be compromised" },
    { text: "Enable two-factor authentication (2FA) on all important accounts" },
    { text: "Monitor bank statements for unauthorised transactions over the next 30 days" },
    { text: "Check your credit report for applications you didn't make" },
  ],
};

const GET_SUPPORT: RecoverySection = {
  title: "Get Support",
  icon: "support",
  items: [
    {
      text: "Lifeline \u2014 24/7 crisis support",
      contactLabel: "13 11 14",
    },
    {
      text: "Beyond Blue \u2014 mental health support",
      contactLabel: "1300 22 4636",
    },
    {
      text: "Financial Counselling Australia",
      contactLabel: "1800 007 007",
    },
  ],
};

const SCAM_TYPE_STEPS: Record<string, RecoverySection> = {
  investment: {
    title: "Investment Scam Recovery",
    icon: "trending_up",
    items: [
      {
        text: "Report to ASIC (Australian Securities & Investments Commission)",
        contactLabel: "1300 300 630",
      },
      { text: "Do not invest any more money, even if promised returns" },
      { text: "Gather all transaction records and correspondence as evidence" },
    ],
  },
  romance: {
    title: "Romance Scam Recovery",
    icon: "favorite",
    items: [
      { text: "Stop sending money immediately \u2014 promises of meeting in person are part of the scam" },
      { text: "Report the fake profile to the dating platform" },
      { text: "Be aware of \u201Crecovery scams\u201D \u2014 someone claiming they can get your money back for a fee" },
    ],
  },
  "tech-support": {
    title: "Tech Support Scam Recovery",
    icon: "computer",
    items: [
      { text: "Uninstall any remote access software (TeamViewer, AnyDesk, etc.)" },
      { text: "Run a full antivirus scan on your device" },
      { text: "Change all passwords from a different, clean device" },
      { text: "Legitimate companies like Microsoft, Apple, and Telstra never cold-call for tech support" },
    ],
  },
  phishing: {
    title: "Phishing Recovery",
    icon: "phishing",
    items: [
      { text: "Change the password on any account you entered credentials for" },
      { text: "Enable 2FA on the compromised account" },
      { text: "Check for unauthorised email forwarding rules or account changes" },
    ],
  },
  impersonation: {
    title: "Impersonation Scam Recovery",
    icon: "person_off",
    items: [
      { text: "Contact the real organisation directly using their official website or phone number" },
      { text: "Do not call back numbers provided in the suspicious message" },
    ],
  },
};

const BRAND_STEPS: Record<string, RecoverySection> = {
  ato: {
    title: "ATO-Specific Steps",
    icon: "account_balance",
    items: [
      {
        text: "Call the ATO directly to verify any tax-related claims",
        contactLabel: "13 28 61",
      },
      { text: "Forward scam texts to the ATO at 0427 225 427" },
      { text: "Check your myGov inbox for genuine ATO messages" },
    ],
  },
  mygov: {
    title: "myGov-Specific Steps",
    icon: "account_balance",
    items: [
      { text: "Log in to myGov directly at my.gov.au (never via a link in a message)" },
      { text: "Change your myGov password and enable multi-factor authentication" },
      {
        text: "Contact Services Australia",
        contactLabel: "136 150",
      },
    ],
  },
  centrelink: {
    title: "Centrelink-Specific Steps",
    icon: "account_balance",
    items: [
      {
        text: "Contact Centrelink directly",
        contactLabel: "136 150",
      },
      { text: "Check your myGov inbox for legitimate Centrelink messages" },
    ],
  },
  "australia-post": {
    title: "Australia Post-Specific Steps",
    icon: "local_shipping",
    items: [
      { text: "Track parcels directly at auspost.com.au" },
      {
        text: "Report scam texts impersonating Australia Post",
        contactLabel: "0429 401 703",
      },
    ],
  },
};

/**
 * Get structured recovery guidance based on scam type and impersonated brand.
 * Returns null for SAFE verdicts.
 */
export function getRecoverySteps(
  scamType?: string,
  impersonatedBrand?: string,
  verdict?: Verdict,
): RecoverySteps | null {
  if (!verdict || verdict === "SAFE") return null;

  const sections: RecoverySection[] = [IMMEDIATE_ACTIONS];

  // Add scam-type-specific steps if available
  if (scamType) {
    const normalised = scamType.toLowerCase().replace(/[\s_]/g, "-");
    const typeSteps = SCAM_TYPE_STEPS[normalised];
    if (typeSteps) sections.push(typeSteps);
  }

  // Add brand-specific steps if available
  if (impersonatedBrand) {
    const normalised = impersonatedBrand.toLowerCase().replace(/[\s_]/g, "-");
    const brandSteps = BRAND_STEPS[normalised];
    if (brandSteps) sections.push(brandSteps);
  }

  sections.push(REPORT_SCAM_AU, PROTECT_ACCOUNTS, GET_SUPPORT);

  return { sections };
}
