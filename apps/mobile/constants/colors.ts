export const Colors = {
  // Brand
  primary: "#6366f1",
  primaryDark: "#4f46e5",
  background: "#1a1a2e",
  surface: "#16213e",
  surfaceLight: "#1f2b47",
  text: "#e2e8f0",
  textSecondary: "#94a3b8",
  border: "#334155",

  // Verdict
  safe: "#22c55e",
  safeBg: "#052e16",
  suspicious: "#f59e0b",
  suspiciousBg: "#451a03",
  highRisk: "#ef4444",
  highRiskBg: "#450a0a",

  // UI
  white: "#ffffff",
  black: "#000000",
  error: "#ef4444",
} as const;

export const VerdictColors = {
  SAFE: { text: Colors.safe, bg: Colors.safeBg },
  SUSPICIOUS: { text: Colors.suspicious, bg: Colors.suspiciousBg },
  HIGH_RISK: { text: Colors.highRisk, bg: Colors.highRiskBg },
} as const;
