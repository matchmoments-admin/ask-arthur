import Link from "next/link";

import Pill from "@/components/Pill";
import { actionsForTake, type TakeAction } from "@/lib/arthurs-take/actions";
import type { TakeDetail } from "@/lib/arthurs-take/loader";
import { CATEGORY_CONFIG } from "@/lib/feed";

/**
 * "What Arthur sees in this pattern" — the reader-facing half of the intel
 * the classifier already produces.
 *
 * Server component: it renders stored text and a curated action map, so there
 * is nothing to hydrate. Keeping it server-side also means no take data is
 * shipped to the client beyond what is on screen.
 *
 * Two rules the copy is bound by, both from the brief and both load-bearing:
 * the subject is a PATTERN, never the person who posted, and colour is never
 * the only carrier of meaning — every chip has a text label, matching
 * FeedCard's convention.
 */

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High confidence";
  if (confidence >= 0.5) return "Medium confidence";
  return "Low confidence";
}

function ActionRow({ action }: { action: TakeAction }) {
  const body = (
    <>
      <span className="font-medium text-deep-navy">{action.label}</span>
      {action.description ? (
        <span className="block text-gov-slate">{action.description}</span>
      ) : null}
      {/* `value` carries the actionable content of a call/info action — the
          phone number, or the guidance about which number to use. Dropping it
          is how an earlier version rendered "Call IDCARE" with nothing to
          call. */}
      {action.value && action.actionKind !== "url" ? (
        <span className="block font-medium text-deep-navy">{action.value}</span>
      ) : null}
    </>
  );

  return (
    <li className="text-sm leading-relaxed">
      {action.href ? (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-deep-navy"
        >
          {body}
        </a>
      ) : (
        body
      )}
      {action.region === "international" ? (
        <span className="ml-1 text-xs text-gov-slate">(international)</span>
      ) : null}
    </li>
  );
}

export default function ArthursTake({ take }: { take: TakeDetail }) {
  const category = CATEGORY_CONFIG[take.intentLabel];
  const actions = actionsForTake(take.intentLabel, {
    isScamReport: take.isScamReport ?? undefined,
  });
  const protective = actions.filter((a) => a.kind === "protective");
  const reporting = actions.filter((a) => a.kind === "reporting");

  return (
    <section
      aria-labelledby="arthurs-take-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6"
    >
      <h2
        id="arthurs-take-heading"
        className="text-lg font-semibold text-deep-navy"
      >
        What Arthur sees in this pattern
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {category ? (
          <Pill label={category.label} color={category.color} />
        ) : (
          <Pill label={take.intentLabel.replace(/_/g, " ")} />
        )}
        <Pill label={confidenceLabel(take.confidence)} />
        {take.isScamReport === false ? (
          <Pill label="Not read as a scam report" color="#6B7280" />
        ) : null}
      </div>

      {take.tells.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gov-slate">
            What gives it away
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-deep-navy">
            {take.tells.map((tell) => (
              <li key={tell}>{tell}</li>
            ))}
          </ul>
        </>
      ) : null}

      {take.where ? (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gov-slate">
            Where it&rsquo;s showing up
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-deep-navy">
            {take.where}
          </p>
        </>
      ) : null}

      {take.auLine ? (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gov-slate">
            In Australia
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-deep-navy">
            {take.auLine}
          </p>
        </>
      ) : null}

      {protective.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gov-slate">
            What to do
          </h3>
          <ul className="mt-2 space-y-2.5">
            {protective.map((a) => (
              <ActionRow key={a.label} action={a} />
            ))}
          </ul>
        </>
      ) : null}

      {reporting.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gov-slate">
            Where to report it
          </h3>
          <ul className="mt-2 space-y-2.5">
            {reporting.map((a) => (
              <ActionRow key={a.label} action={a} />
            ))}
          </ul>
        </>
      ) : null}

      {take.themeSlug && take.themeTitle ? (
        <p className="mt-5 text-sm">
          <Link
            href={`/intel/themes/${take.themeSlug}`}
            className="underline underline-offset-2 hover:text-deep-navy"
          >
            Related pattern: {take.themeTitle}
          </Link>
        </p>
      ) : null}

      <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-relaxed text-gov-slate">
        Arthur&rsquo;s analysis of the pattern described in this report, not a
        judgment about the person who posted it. Generated automatically and
        reviewed for accuracy.
      </p>
    </section>
  );
}
