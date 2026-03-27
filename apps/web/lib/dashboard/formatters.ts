// Dashboard number/date formatting utilities

export function formatAUD(amount: number | null): string {
  if (amount === null || amount === 0) return "—";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-AU");
}

export function formatRelative(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const RISK_COLOURS: Record<string, string> = {
  CRITICAL: "#B71C1C",
  HIGH: "#D32F2F",
  MEDIUM: "#F57C00",
  LOW: "#388E3C",
  UNKNOWN: "#94A3B8",
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  url: "URL",
  domain: "Domain",
  ip: "IP",
  crypto_wallet: "Crypto",
  bank_account: "Bank Acct",
};
