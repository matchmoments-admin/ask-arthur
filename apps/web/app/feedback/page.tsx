// Server-rendered landing for thumbs-up/down links in the
// inbound-scan verdict email (apps/web/emails/InboundScanResult.tsx).
//
// The email link carries an HMAC-signed token (id + verdict + vote + exp);
// this route verifies the signature, derives `user_says` the same way the
// web `ResultFeedback` component does (apps/web/components/result/
// ResultFeedback.tsx), and inserts a row into `verdict_feedback` tagged
// with `reason_codes=["inbound_scan"]` so we can roll up email-channel
// feedback separately in /admin/feedback later.
//
// GET-driven mutation is the only practical shape — email clients can't
// POST. The HMAC + 7-day expiry constrains forgery; duplicate clicks
// are idempotent from the user POV (the page renders thanks either way)
// and we accept that the row gets written once per click.

import Link from "next/link";
import { headers } from "next/headers";

import { createServiceClient } from "@askarthur/supabase/server";
import { hashIdentifier } from "@askarthur/utils";
import { logger } from "@askarthur/utils/logger";

import { verifyFeedbackToken, deriveUserSays } from "@/lib/inbound-scan-feedback";
import Footer from "@/components/Footer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome = "recorded" | "invalid" | "unavailable";

async function recordFeedback(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<Outcome> {
  // Flatten possibly-arrayed search params back to a URLSearchParams shape
  // so verifyFeedbackToken can consume them uniformly.
  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      if (value[0]) flat.set(key, value[0]);
    } else if (typeof value === "string") {
      flat.set(key, value);
    }
  }

  const verified = verifyFeedbackToken(flat);
  if (!verified) return "invalid";

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("inbound-scan feedback: supabase service client unavailable");
    return "unavailable";
  }

  const hdrs = await headers();
  const ip =
    hdrs.get("x-real-ip") || hdrs.get("x-forwarded-for") || "inbound_scan_email";
  const ua = hdrs.get("user-agent") || "email-link-follower";
  const reporterHash = await hashIdentifier(ip, ua);

  const { error } = await supabase.from("verdict_feedback").insert({
    reporter_hash: reporterHash,
    verdict_given: verified.verdict,
    user_says: deriveUserSays(verified.verdict, verified.vote),
    analysis_id: verified.externalId,
    // Tag the channel so /admin/feedback can split inbound-scan feedback
    // from web. `reason_codes` is documented as a free-form app-layer
    // vocabulary (migration v66 comment), so adding a `inbound_scan`
    // marker doesn't conflict with the web reason-code enum.
    reason_codes: ["inbound_scan"],
    training_consent: false,
    user_agent_family: "email",
    locale: "en-AU",
  });

  if (error) {
    logger.error("inbound-scan feedback: insert failed", {
      error: error.message,
      external_id: verified.externalId,
    });
    return "unavailable";
  }

  return "recorded";
}

export default async function FeedbackLandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const outcome = await recordFeedback(sp);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />

      <nav
        aria-label="Main navigation"
        className="w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100"
      >
        <Link
          href="/"
          className="text-deep-navy font-extrabold text-lg uppercase tracking-wide"
        >
          Ask Arthur
        </Link>
      </nav>

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        {outcome === "recorded" && (
          <>
            <h1 className="text-deep-navy text-3xl font-extrabold mb-4">
              Thanks — that helps us recognise scams better.
            </h1>
            <p className="text-gov-slate text-base leading-relaxed mb-6">
              Every thumbs-up and thumbs-down tunes Arthur&apos;s eye for
              what real Aussies are seeing in their inboxes.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <p className="text-deep-navy font-bold mb-2">
                Help other Aussies find Arthur
              </p>
              <p className="text-gov-slate text-sm leading-relaxed mb-3">
                A quick Trustpilot review helps the next person find us
                before the scammers do.
              </p>
              <a
                href="https://au.trustpilot.com/evaluate/askarthur.au"
                className="inline-block bg-deep-navy text-white font-bold uppercase tracking-widest text-sm rounded-[4px] px-5 py-3 hover:bg-navy transition-colors"
              >
                Leave a review →
              </a>
            </div>
          </>
        )}

        {outcome === "invalid" && (
          <>
            <h1 className="text-deep-navy text-3xl font-extrabold mb-4">
              This feedback link has expired
            </h1>
            <p className="text-gov-slate text-base leading-relaxed mb-6">
              Feedback links last seven days. If you&apos;d still like to
              tell us how Arthur did, forward another email to{" "}
              <a
                href="mailto:scan@askarthur.au"
                className="text-action-teal underline"
              >
                scan@askarthur.au
              </a>{" "}
              and use the buttons in the reply.
            </p>
            <Link
              href="/"
              className="inline-block bg-deep-navy text-white font-bold uppercase tracking-widest text-sm rounded-[4px] px-5 py-3 hover:bg-navy transition-colors"
            >
              Back to Ask Arthur
            </Link>
          </>
        )}

        {outcome === "unavailable" && (
          <>
            <h1 className="text-deep-navy text-3xl font-extrabold mb-4">
              We couldn&apos;t record that just now
            </h1>
            <p className="text-gov-slate text-base leading-relaxed mb-6">
              Something went wrong on our end. Your verdict email is still
              valid — try the thumbs buttons again in a few minutes.
            </p>
            <Link
              href="/"
              className="inline-block bg-deep-navy text-white font-bold uppercase tracking-widest text-sm rounded-[4px] px-5 py-3 hover:bg-navy transition-colors"
            >
              Back to Ask Arthur
            </Link>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
