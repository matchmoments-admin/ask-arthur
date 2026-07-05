// Clone Watch spoke manifest — the single source of truth for the hub-and-spoke
// content cluster. Spokes are authored as blog posts (they render at
// /blog/[slug]); this manifest is what the pillar links DOWN to and what the
// per-post CTA injects as lateral links. An orphan-check test
// (apps/web/__tests__/cloneWatchLinks.test.ts) fails the build if the cluster's
// link graph breaks (dangling lateral, unreferenced spoke, duplicate slug).
//
// `lateralSlugs` are the 2-3 related spokes each post cross-links to. The graph
// is authored so EVERY spoke has at least one inbound lateral link (no orphan),
// which is what signals topical authority and distributes internal link equity.

export interface CloneWatchSpoke {
  slug: string; // blog post slug -> /blog/<slug>
  title: string;
  targetKeyword: string;
  lateralSlugs: string[];
}

export const CLONE_WATCH_PILLAR_PATH = "/clone-watch";

export const CLONE_WATCH_SPOKES: CloneWatchSpoke[] = [
  {
    slug: "lookalike-domain-defence-playbook",
    title: "The lookalike-domain defensive playbook",
    targetKeyword: "lookalike domain takedown",
    lateralSlugs: ["superannuation-scam-target-hesta", "registrar-accountability-clone-domains"],
  },
  {
    slug: "superannuation-scam-target-hesta",
    title: "Superannuation is a new scam frontier",
    targetKeyword: "superannuation scams Australia",
    lateralSlugs: ["banking-clones-spf-reasonable-steps", "lookalike-domain-defence-playbook"],
  },
  {
    slug: "retail-most-cloned-sector",
    title: "Why retail is the most-cloned sector",
    targetKeyword: "retail brand impersonation Australia",
    lateralSlugs: ["black-friday-shopfront-clone-surge", "lookalike-domain-defence-playbook"],
  },
  {
    slug: "registrar-accountability-clone-domains",
    title: "Registrar accountability: who enables clone domains",
    targetKeyword: "registrar abuse clone domains",
    lateralSlugs: ["clone-to-phishing-site-anatomy", "defensive-domain-registration-worth-it"],
  },
  {
    slug: "black-friday-shopfront-clone-surge",
    title: "The Black Friday shopfront-clone surge",
    targetKeyword: "fake online store Black Friday",
    lateralSlugs: ["retail-most-cloned-sector", "telco-delivery-clones-auspost-toll"],
  },
  {
    slug: "state-of-brand-impersonation-australia-2026",
    title: "State of brand impersonation in Australia 2026",
    targetKeyword: "brand impersonation Australia report",
    lateralSlugs: ["registrar-accountability-clone-domains", "one-year-clone-watch"],
  },
  {
    slug: "banking-clones-spf-reasonable-steps",
    title: "Banking clones and the SPF reasonable-steps test",
    targetKeyword: "bank scam website SPF reasonable steps",
    lateralSlugs: ["digital-platforms-paid-search-clones-spf", "lookalike-domain-defence-playbook"],
  },
  {
    slug: "clone-to-phishing-site-anatomy",
    title: "How a clone becomes a phishing site",
    targetKeyword: "anatomy of a phishing clone",
    lateralSlugs: ["registrar-accountability-clone-domains", "state-of-brand-impersonation-australia-2026"],
  },
  {
    slug: "digital-platforms-paid-search-clones-spf",
    title: "Digital platforms, paid-search clones and the SPF Codes",
    targetKeyword: "paid search brand impersonation",
    lateralSlugs: ["banking-clones-spf-reasonable-steps", "clone-to-phishing-site-anatomy"],
  },
  {
    slug: "defensive-domain-registration-worth-it",
    title: "Defensive domain registration: is it worth it?",
    targetKeyword: "defensive domain registration",
    lateralSlugs: ["registrar-accountability-clone-domains", "state-of-brand-impersonation-australia-2026"],
  },
  {
    slug: "telco-delivery-clones-auspost-toll",
    title: "Telco and delivery clones (Australia Post, Toll)",
    targetKeyword: "Australia Post scam website",
    lateralSlugs: ["black-friday-shopfront-clone-surge", "digital-platforms-paid-search-clones-spf"],
  },
  {
    slug: "one-year-clone-watch",
    title: "One year of Clone Watch: what changed",
    targetKeyword: "brand impersonation trends Australia",
    lateralSlugs: ["state-of-brand-impersonation-australia-2026", "lookalike-domain-defence-playbook"],
  },
];

const BY_SLUG = new Map(CLONE_WATCH_SPOKES.map((s) => [s.slug, s]));

export function isCloneWatchSpoke(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/**
 * Markdown link block injected into a Clone Watch spoke post: a pillar backlink
 * (consistent "Clone Watch" anchor) + the spoke's lateral links. Returns "" for
 * a non-spoke slug. `includePillar` respects the #371 gate (the pillar isn't
 * public yet) — pass featureFlags-derived value from the caller.
 */
export function cloneWatchSpokeLinks(slug: string, includePillar: boolean): string {
  const spoke = BY_SLUG.get(slug);
  if (!spoke) return "";

  const parts: string[] = [];
  if (includePillar) {
    parts.push(`This is part of [Clone Watch](${CLONE_WATCH_PILLAR_PATH}) — Ask Arthur's monthly brand-impersonation tracker.`);
  }
  const laterals = spoke.lateralSlugs
    .map((ls) => BY_SLUG.get(ls))
    .filter((s): s is CloneWatchSpoke => Boolean(s))
    .map((s) => `- [${s.title}](/blog/${s.slug})`);
  if (laterals.length > 0) {
    parts.push(`**Related reading**\n\n${laterals.join("\n")}`);
  }
  return parts.join("\n\n");
}
