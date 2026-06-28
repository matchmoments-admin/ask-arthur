export const Colors = {
  // Brand — matches web app design system
  primary: "#008A98",       // Action Teal — buttons, links, active states
  primaryDark: "#007080",   // Darker teal for pressed states
  navy: "#001F3F",          // Deep Navy — headers, navigation
  navyLight: "#002B45",     // Lighter navy

  // Backgrounds
  background: "#F7F8FA",    // Light gray page background
  surface: "#FFFFFF",       // White card/surface
  surfaceHover: "#F0F2F5",  // Slightly darker for pressed states

  // Text
  text: "#42526E",          // Gov Slate — primary body text
  textSecondary: "#6B7C93", // Secondary text
  textOnDark: "#FFFFFF",    // White text on dark backgrounds
  textOnPrimary: "#FFFFFF", // White text on primary color

  // Borders
  border: "#E1E4E8",
  borderLight: "#F0F0F0",

  // Verdict
  safe: "#388E3C",
  safeBg: "#ECFDF5",
  // "Never reassure" caution palette — used by the SAFE *verdict* so it reads
  // amber, not green (the raw `safe`/`safeBg` tokens stay green for non-verdict
  // UI like the breach-clean state).
  caution: "#B45309",
  cautionBg: "#FFFBEB",
  uncertain: "#6B7C93",
  uncertainBg: "#F0F2F5",
  suspicious: "#F57C00",
  suspiciousBg: "#FFF8E1",
  highRisk: "#D32F2F",
  highRiskBg: "#FEF2F2",

  // UI
  white: "#FFFFFF",
  black: "#000000",
  error: "#D32F2F",
  errorBg: "#FEF2F2",
} as const;

export const VerdictColors = {
  // SAFE reads amber ("never reassure"), not green — see caution tokens above.
  SAFE: { text: Colors.caution, bg: Colors.cautionBg },
  UNCERTAIN: { text: Colors.uncertain, bg: Colors.uncertainBg },
  SUSPICIOUS: { text: Colors.suspicious, bg: Colors.suspiciousBg },
  HIGH_RISK: { text: Colors.highRisk, bg: Colors.highRiskBg },
} as const;
