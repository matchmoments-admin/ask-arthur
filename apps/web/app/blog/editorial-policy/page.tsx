import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Editorial Policy — External Links — Ask Arthur",
  description:
    "How Ask Arthur chooses the external links that appear on our blog, and why we never add links in exchange for outreach requests.",
  alternates: {
    canonical: "https://askarthur.au/blog/editorial-policy",
  },
};

export default function EditorialPolicyPage() {
  return (
    <article className="max-w-2xl mx-auto py-14 px-5">
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">
        <Link href="/blog" className="hover:text-action-teal">
          Blog
        </Link>{" "}
        / Editorial policy
      </p>
      <h1 className="text-deep-navy text-3xl font-bold mb-6">
        Editorial policy: external links
      </h1>

      <div className="space-y-5 text-base text-gov-slate leading-relaxed">
        <p>
          Some Ask Arthur blog posts end with a{" "}
          <strong>&ldquo;Further reading&rdquo;</strong> section linking to
          articles on other websites. This page explains how those links are
          chosen.
        </p>

        <h2 className="text-deep-navy text-xl font-bold pt-2">
          How we choose links
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Every external link is <strong>editorially selected</strong> by
            Ask Arthur because we believe it genuinely helps readers avoid or
            recover from scams.
          </li>
          <li>
            We prioritise Australian government sources (Scamwatch, the eSafety
            Commissioner, the ACSC, ASIC), regulators, non-profits such as
            IDCARE, academic research, and independent journalism.
          </li>
          <li>
            Commercial content is considered case-by-case on its merits. A link
            is <strong>never added solely because a company or marketer asked
            us to</strong> — outreach emails requesting links do not result in
            placements.
          </li>
        </ul>

        <h2 className="text-deep-navy text-xl font-bold pt-2">
          What the links mean (and don&apos;t mean)
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            An external link is not an endorsement of the site, its products,
            or its owners. Ask Arthur is not responsible for third-party
            content.
          </li>
          <li>
            All external &ldquo;Further reading&rdquo; links carry{" "}
            <code className="text-sm bg-slate-50 px-1 py-0.5 rounded">
              rel=&quot;nofollow&quot;
            </code>{" "}
            — we link for readers, not for search-engine rankings, ours or
            anyone else&apos;s.
          </li>
          <li>
            If a placement were ever paid or affiliated (none are today), it
            would be clearly disclosed and marked{" "}
            <code className="text-sm bg-slate-50 px-1 py-0.5 rounded">
              rel=&quot;sponsored&quot;
            </code>
            .
          </li>
        </ul>

        <h2 className="text-deep-navy text-xl font-bold pt-2">
          Suggesting a resource
        </h2>
        <p>
          If you think a resource would genuinely help our readers, you&apos;re
          welcome to suggest it via our{" "}
          <Link href="/contact" className="underline hover:text-action-teal">
            contact form
          </Link>
          . We read every suggestion, but we add links only on editorial merit
          and we don&apos;t reply to bulk link-building outreach.
        </p>
      </div>
    </article>
  );
}
