// Single source of truth for UTM tagging on outbound links (email, on-page
// CTAs, etc.). Centralised so that when Plausible's UTM-handling rules
// change or a new analytics destination is added, only this file moves.

export interface UtmParams {
  source: string;
  campaign: string;
  medium?: string;
}

export function withUtm(url: string, p: UtmParams): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_campaign", p.campaign);
  if (p.medium) u.searchParams.set("utm_medium", p.medium);
  return u.toString();
}
