// Composed footprint report — BandBadge + CoverageChips + PillarGrid +
// contextual callouts. Used by the consumer inline view (after a lookup)
// and the persisted /phone-footprint/[id] page.
//
// Compliance-aware: when tier === 'teaser' OR ownership_proven === false,
// renders an explainer CTA ("See the full footprint of your own number")
// so users understand why the detail is redacted. This is the UX surface
// of the APP 3.5 self-lookup defence.

import Link from "next/link";
import type { Footprint } from "@askarthur/scam-engine/phone-footprint";
import { BandBadge } from "./BandBadge";
import { CoverageChips } from "./CoverageChips";
import { PillarGrid } from "./PillarGrid";

interface Props {
  footprint: Footprint;
  ownershipProven: boolean;
  crossIpDowngrade: boolean;
}

export function FootprintReport({ footprint, ownershipProven, crossIpDowngrade }: Props) {
  const redacted = footprint.tier === "teaser";

  return (
    <article className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wider uppercase text-gray-500">
            Phone footprint
          </p>
          <h1 className="mt-1 font-serif text-2xl text-gray-900">
            {footprint.msisdn_e164}
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            Generated {new Date(footprint.generated_at).toLocaleString()}
          </p>
        </div>
        <BandBadge score={footprint.composite_score} band={footprint.band} />
      </header>

      <CoverageChips coverage={footprint.coverage} />

      {crossIpDowngrade && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Summary only.</strong> This number has been
          looked up from several sources in the last 24 hours, so we&rsquo;re
          showing a summary rather than full detail to discourage bulk lookup
          of personal numbers. If this is your number,{" "}
          <Link href="/phone-footprint/verify" className="underline">verify ownership</Link> to
          see the full report.
        </div>
      )}

      {redacted && !crossIpDowngrade && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <strong className="font-semibold">Teaser view.</strong>{" "}
          {ownershipProven ? (
            <>This is a shared or public summary.</>
          ) : (
            <>
              To see which breaches, scam reports, or carrier details
              triggered this score,{" "}
              <Link href="/phone-footprint/verify" className="underline">verify you own this number</Link>{" "}
              with a one-time SMS code.
            </>
          )}
        </div>
      )}

      <section aria-labelledby="pillars-h">
        <h2 id="pillars-h" className="mb-3 text-sm font-semibold text-gray-700">
          Signal breakdown
        </h2>
        <PillarGrid footprint={footprint} />
      </section>

      {footprint.explanation && !redacted && (
        <section aria-labelledby="explanation-h" className="rounded-xl bg-gray-50 p-4">
          <h2 id="explanation-h" className="mb-2 text-sm font-semibold text-gray-700">
            In plain English
          </h2>
          <p className="text-sm leading-relaxed text-gray-800">
            {footprint.explanation}
          </p>
        </section>
      )}

      <footer className="text-xs text-gray-500">
        Sources used: {footprint.providers_used.length > 0 ? footprint.providers_used.join(", ") : "none"}.
        Snapshot expires {new Date(footprint.expires_at).toLocaleDateString()}.
      </footer>
    </article>
  );
}
