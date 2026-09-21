// Clone-watch pre-classifier vocabulary — the ONE home for the three enums
// that both classifiers (Haiku, v157; Jev shadow lane, v311) answer in, and
// that the two sibling tables' CHECK constraints mirror.
//
// Why a module: the Haiku Zod schema and the Jev question set must name the
// same options or the calibration comparison silently degrades (a tactic
// only one side can say is unmeasurable). Deriving both from these arrays
// makes drift a type error, and the descriptions double as the Jev
// `criteria` text — the same one-liners the Haiku SYSTEM_PROMPT carries.
//
// Adding a value here requires a migration widening BOTH CHECK constraints
// (`clone_watch_classifications`, `clone_watch_jev_classifications`).

export const CLONE_TACTICS = {
  typosquat:
    "single-char insertion/deletion/swap of the brand name (e.g. csrsales)",
  homograph: "IDN / unicode confusables (e.g. xn--auspst-9ya)",
  brandjack: "brand name + appended word (e.g. nab-secure)",
  lookalike_tld: "same name on a different TLD (e.g. nab.shop)",
  subdomain_abuse:
    "brand as a subdomain of another host (e.g. nab.evil-host.com)",
  compound_word: "brand inside a longer compound (e.g. mynabaccount)",
  unrelated: "non-clone — the name overlap is a coincidence",
  parked: "non-clone — marketplace-parked domain",
  other: "a clone by some other technique",
} as const;

export const ATTACK_INTENTS = {
  credential_phishing: "harvest logins or one-time codes",
  payment_fraud: "collect card or bank payment under false pretences",
  malware_delivery: "deliver malware or a malicious download",
  investment_scam: "fake investment or trading platform",
  fake_marketplace: "fake shop or marketplace that never ships",
  crypto_scam: "cryptocurrency theft or fake exchange",
  support_scam: "fake customer support or tech support",
  unknown: "intent cannot be inferred from the domain alone",
} as const;

export const RISK_INDICATORS = {
  urgency_words:
    "the domain or URL contains urgency words (verify, urgent, alert, suspended)",
  payment_form_url: "the URL path suggests a payment form",
  login_form_url: "the URL path suggests a login form",
  crypto_address: "the domain or URL references a crypto wallet or address",
  fake_promotion:
    "the domain or URL promises a prize, refund, bonus or promotion",
  suspicious_tld:
    "the TLD is one commonly abused for phishing (.top, .xyz, .icu, .shop, …)",
  new_registration:
    "the domain reads as a fresh registration made for this campaign",
} as const;

export type CloneTactic = keyof typeof CLONE_TACTICS;
export type AttackIntent = keyof typeof ATTACK_INTENTS;
export type RiskIndicator = keyof typeof RISK_INDICATORS;

function keysOf<T extends Record<string, string>>(
  obj: T,
): [keyof T & string, ...(keyof T & string)[]] {
  const keys = Object.keys(obj) as (keyof T & string)[];
  if (keys.length === 0) throw new Error("vocabulary must not be empty");
  return keys as [keyof T & string, ...(keyof T & string)[]];
}

/** Tuple forms for `z.enum(...)` — z.enum needs a non-empty tuple, not a string[]. */
export const CLONE_TACTIC_VALUES = keysOf(CLONE_TACTICS);
export const ATTACK_INTENT_VALUES = keysOf(ATTACK_INTENTS);
export const RISK_INDICATOR_VALUES = keysOf(RISK_INDICATORS);
