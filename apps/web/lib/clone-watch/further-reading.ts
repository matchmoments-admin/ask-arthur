// Which evergreen blog post the monthly Clone Watch first comment links to.
//
// The first comment used to offer only the checker and the partner page —
// nothing that teaches, and the same two links every month. This picks a post
// that matches the month's lead story, so a reader who just learned that (say)
// a super fund was targeted gets the deep-dive on that, and each edition sends
// traffic to a different page instead of compounding on one.
//
// Deterministic and pure: same inputs → same link, so a caption regenerated for
// an old month is stable. Slugs are checked by a drift test against the live
// blog_posts table (any rename fails CI rather than shipping a 404).

export interface FurtherReading {
  slug: string;
  /** Reader-facing label for the link in the first comment. */
  label: string;
}

/** Evergreen posts, keyed by the theme they serve. */
const BY_THEME: Record<string, FurtherReading> = {
  bank: {
    slug: "real-story-anz-bank-text-holiday-card-fraud",
    label: "How a real bank-impersonation text played out",
  },
  gov: {
    slug: "is-that-mygov-email-real-how-to-check",
    label: "Is that myGov email real? How to check",
  },
  telco: {
    slug: "nbn-scam-calls-they-wont-disconnect-you",
    label: "Telco and NBN scam calls, explained",
  },
  delivery: {
    slug: "australia-post-delivery-scam-texts",
    label: "Delivery-text scams: the tells",
  },
  retail: {
    slug: "facebook-marketplace-scam-check-guide",
    label: "Checking an online seller before you pay",
  },
  email: {
    slug: "how-to-check-a-suspicious-email-in-under-a-minute",
    label: "Check a suspicious email in under a minute",
  },
  generic: {
    slug: "how-to-check-if-a-message-is-a-scam",
    label: "How to check if a message is a scam",
  },
  aftermath: {
    slug: "what-to-do-if-youve-been-scammed-australia",
    label: "What to do if you've been scammed",
  },
};

/** Rotation used when the lead brand matches no theme — cycles by month so two
 *  consecutive editions never repeat. */
const ROTATION: FurtherReading[] = [
  BY_THEME.generic,
  BY_THEME.email,
  BY_THEME.retail,
  BY_THEME.aftermath,
  BY_THEME.delivery,
  BY_THEME.gov,
];

/** Domain fragments → theme. First match wins; order is most-specific-first. */
const BRAND_THEMES: Array<[RegExp, string]> = [
  [/(bank|nab|anz|cba|commbank|westpac|ubank|up\.com|revolut|wise|airwallex|paypal|afterpay|stake|coinbase|kraken|coinspot|vanguard|super|hesta|hostplus|rest|aware|unisuper)/, "bank"],
  [/(mygov|medicare|ato\.gov|servicesaustralia|ndis|centrelink)/, "gov"],
  [/(telstra|optus|vodafone|iinet|tpg|nbn|amaysim|belong)/, "telco"],
  [/(auspost|australiapost|startrack|dhl|fedex|linkt|toll)/, "delivery"],
  [/(kmart|target|coles|woolworths|bunnings|amazon|aldi|bigw|myer|harveynorman|jbhifi|gluestore|smiggle|bws)/, "retail"],
  [/(apple|google|microsoft|spotify|booking|wotif|jetstar|qantas)/, "email"],
];

/**
 * Pick the further-reading link for an edition.
 * @param leadBrand the month's lead/spotlit brand domain (may be empty)
 * @param periodMonth ISO month start, e.g. "2026-07-01" — drives the rotation
 */
export function pickFurtherReading(
  leadBrand: string | null | undefined,
  periodMonth: string,
): FurtherReading {
  const brand = (leadBrand ?? "").toLowerCase();
  if (brand) {
    for (const [pattern, theme] of BRAND_THEMES) {
      if (pattern.test(brand)) return BY_THEME[theme];
    }
  }
  // Rotation fallback: month index keeps consecutive editions different.
  const monthIndex = Number(periodMonth.slice(0, 4)) * 12 + Number(periodMonth.slice(5, 7));
  return ROTATION[monthIndex % ROTATION.length];
}

/** Every slug this module can emit — used by the drift test. */
export const FURTHER_READING_SLUGS: string[] = Array.from(
  new Set(Object.values(BY_THEME).map((f) => f.slug)),
);
