/**
 * Centralized affiliate link registry (D2).
 * All affiliate/partner links are managed here for consistency
 * and easy rotation/removal.
 */

interface AffiliateLink {
  name: string;
  url: string;
  category: "vpn" | "password_manager" | "antivirus" | "identity_protection" | "security_tool";
  description: string;
}

export const affiliateLinks: AffiliateLink[] = [
  {
    name: "NordVPN",
    url: "https://nordvpn.com/askarthur",
    category: "vpn",
    description: "Secure your internet connection with military-grade encryption",
  },
  {
    name: "1Password",
    url: "https://1password.com/askarthur",
    category: "password_manager",
    description: "Generate and store unique passwords for every account",
  },
  {
    name: "Bitdefender",
    url: "https://bitdefender.com/askarthur",
    category: "antivirus",
    description: "Real-time protection against malware and ransomware",
  },
  {
    name: "IDCare",
    url: "https://www.idcare.org",
    category: "identity_protection",
    description: "Australia's national identity and cyber support service (free)",
  },
  {
    name: "Have I Been Pwned",
    url: "https://haveibeenpwned.com",
    category: "security_tool",
    description: "Check if your email has been in a data breach",
  },
];

/**
 * Get affiliate links relevant to a specific context.
 */
export function getRelevantLinks(
  context: "post_scan" | "recovery" | "general"
): AffiliateLink[] {
  switch (context) {
    case "post_scan":
      return affiliateLinks.filter((l) =>
        ["vpn", "password_manager", "antivirus"].includes(l.category)
      );
    case "recovery":
      return affiliateLinks.filter((l) =>
        ["identity_protection", "password_manager", "security_tool"].includes(l.category)
      );
    case "general":
    default:
      return affiliateLinks;
  }
}

export type { AffiliateLink };
