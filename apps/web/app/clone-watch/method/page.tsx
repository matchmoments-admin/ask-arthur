// Clone Watch methodology — the permanent, factual "how we measure this" page.
// Transparent methodology is what makes the numbers citable and defensible
// (borrow the CTI inverted-pyramid: finding first, method + caveats below).
//
// Deliberately factual and non-characterising, so it is the least #371-sensitive
// of the owned-media pages. Still `noindex` until FF_CLONE_WATCH_PUBLIC is ON.

import type { Metadata } from "next";
import Link from "next/link";
import { featureFlags } from "@askarthur/utils/feature-flags";

const indexable = featureFlags.cloneWatchPublic;

export const metadata: Metadata = {
  title: "Clone Watch — methodology | Ask Arthur",
  description:
    "How Ask Arthur's Clone Watch detects Australian brand-lookalike domains: data sources, watch-list scope, classification, definitions, limitations, and the correction process.",
  robots: { index: indexable, follow: indexable },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-deep-navy text-lg font-bold mb-2">{title}</h2>
      <div className="text-gov-slate text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function CloneWatchMethodPage() {
  return (
    <>
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-deep-navy">
        <Link href="/clone-watch" className="hover:underline">
          Clone Watch
        </Link>{" "}
        · methodology
      </div>
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
        How we measure Clone Watch
      </h1>
      <p className="text-lg text-gov-slate mb-8 leading-relaxed">
        Clone Watch is a monthly, transparent measurement of newly-registered
        domains whose names resemble Australian brands. Every number we publish
        is reproducible from the sources below. Detections are{" "}
        <strong>suspected lookalikes submitted for review — not adjudicated
        findings</strong>.
      </p>

      <Section title="Data sources">
        <p>
          Newly-registered-domain (NRD) lists from whoisds.com (free public
          tier); WHOIS registration records; Certificate Transparency logs; and
          urlscan.io evidence for domains that resolve to a live page.
        </p>
      </Section>

      <Section title="Scope">
        <p>
          We match against a reference watch-list of roughly 50 Australian
          retail, bank, telco, superannuation, and logistics brand names, plus a
          small set of heavily-targeted global brands. The list is curated and
          evolves; it is not exhaustive.
        </p>
      </Section>

      <Section title="How a domain is matched">
        <p>
          A deterministic lexical sweep flags newly-registered domains whose
          string is characteristically similar to a watch-list brand —
          typo-squats (one-character changes), homoglyph/confusable characters,
          brand-name substrings, and alternate top-level domains. Candidates are
          then classified (including an AI pre-classifier and, where the domain
          resolves, urlscan evidence).
        </p>
      </Section>

      <Section title="Definitions">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Lookalike / suspected clone</strong> — a domain whose name
            resembles a watch-list brand by the measurement above. Not a claim
            that the registrant is a scammer.
          </li>
          <li>
            <strong>Likely phishing</strong> — the domain resolves to a page that
            urlscan or our classifier assesses as consistent with credential
            harvesting.
          </li>
          <li>
            <strong>Parked / for sale</strong> — the domain resolves to a
            registrar parking or domain-sale page, not brand-impersonating
            content.
          </li>
          <li>
            <strong>Submitted for takedown review</strong> — referred to a
            community blocklist provider (e.g. Netcraft) for independent
            assessment. Referral is not a finding of abuse.
          </li>
        </ul>
      </Section>

      <Section title="Limitations">
        <ul className="list-disc pl-5 space-y-1">
          <li>NRD feeds and blocklists count reported/registered domains, not confirmed abuse.</li>
          <li>Raw registrar counts partly reflect registrar size; we do not infer that a registrar condones abuse.</li>
          <li>We report month-over-month deltas and always state the measurement window.</li>
          <li>We do not publish live clone URLs in clickable form, per-victim data, or which brands are least defended.</li>
        </ul>
      </Section>

      <Section title="Corrections & disputes">
        <p>
          If your brand or business is named and you believe a domain is
          legitimate (for example your own defensive registration or a licensed
          reseller), email{" "}
          <a href="mailto:hello@askarthur.au" className="underline font-medium">
            hello@askarthur.au
          </a>
          . We will share the specific evidence privately, log the dispute, and
          correct or remove the entry promptly where warranted.
        </p>
      </Section>

      <p className="text-sm text-gov-slate mt-10 pt-6 border-t border-deep-navy/10">
        Back to the{" "}
        <Link href="/clone-watch" className="underline">Clone Watch pillar</Link>{" "}
        and monthly editions.
      </p>
    </>
  );
}
