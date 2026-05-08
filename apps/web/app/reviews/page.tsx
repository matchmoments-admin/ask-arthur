import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Leave a review | Ask Arthur",
  description:
    "If Arthur has helped your team or organisation, an honest review on G2 or Capterra helps other Australian businesses find us.",
};

const REVIEW_PLATFORMS: Array<{
  name: string;
  url: string;
  description: string;
  audience: "consumer" | "b2b";
}> = [
  {
    name: "G2",
    url: "https://www.g2.com/products/ask-arthur/reviews",
    description:
      "The dominant B2B software review site — buyer-intent data feeds enterprise sales conversations.",
    audience: "b2b",
  },
  {
    name: "Capterra",
    url: "https://www.capterra.com.au/reviews/ask-arthur",
    description:
      "Gartner-owned. A review here syndicates automatically to GetApp and Software Advice.",
    audience: "b2b",
  },
  {
    name: "Trustpilot",
    url: "https://au.trustpilot.com/evaluate/askarthur.au",
    description:
      "Consumer-leaning, but useful for branded SEO and Australian discovery.",
    audience: "consumer",
  },
];

export default function ReviewsPage() {
  return (
    <main className="max-w-[640px] mx-auto px-5 py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-gov-slate mb-2">
          Optional
        </p>
        <h1 className="text-3xl font-bold text-deep-navy">
          Leave a review
        </h1>
        <p className="mt-3 text-base text-gov-slate leading-relaxed">
          We don&apos;t prompt for reviews inside the product — funnelling happy
          users skews the signal. But if Arthur has helped your team or
          organisation and you&apos;ve come here on your own, an honest review
          helps other Australian businesses find us.
        </p>
        <p className="mt-3 text-base text-gov-slate leading-relaxed">
          For a real-time accuracy view that nobody filters, see{" "}
          <Link href="/accuracy" className="underline text-deep-navy font-bold">
            askarthur.au/accuracy
          </Link>
          .
        </p>
      </header>

      <section className="mt-8 space-y-3">
        {REVIEW_PLATFORMS.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-border-light bg-white p-4 hover:border-action-teal transition"
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <h2 className="font-bold text-deep-navy text-base">{p.name}</h2>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gov-slate">
                {p.audience === "b2b" ? "B2B" : "Consumer"}
              </span>
            </div>
            <p className="text-sm text-gov-slate leading-relaxed">
              {p.description}
            </p>
          </a>
        ))}
      </section>

      <section className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="font-bold text-deep-navy text-sm mb-2">
          Why we don&apos;t ask in-app
        </h2>
        <p className="text-sm text-gov-slate leading-relaxed">
          Trust is earned, not solicited at filtered moments. Most products
          time their review prompts after a positive event — that&apos;s
          selection bias dressed up as data, and on a tool whose job is
          spotting deception, doing that would be the thing we warn people
          about. If Arthur didn&apos;t work for you, your candour is more
          valuable than a 5-star review.
        </p>
      </section>
    </main>
  );
}
