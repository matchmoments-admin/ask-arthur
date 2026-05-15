// /sim-swap-check — private-beta web page for the on-demand SIM-swap
// check. Server component: flag + auth gate, then hands off to the
// client flow.
//
// Renders states:
//   1. flag off                      → notFound() (404)
//   2. signed out                    → /login redirect with ?next + invite
//   3. signed in, no invite redeemed → InviteForm (redeem flow)
//   4. signed in, invite redeemed    → CheckFlow (verify number + run check)
//
// The OTP step reuses /api/phone-footprint/verify/{start,check} —
// those already set the `pf:owner:{user}:{hash}` Upstash key that
// /api/sim-swap/check reads.

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { InviteForm } from "./InviteForm";
import { CheckFlow } from "./CheckFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SIM-swap check | Ask Arthur",
  description:
    "Check if your SIM has been swapped before entering an SMS code. Live carrier-direct check via Telstra. Private beta.",
};

interface PageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SimSwapCheckPage({ searchParams }: PageProps) {
  if (!featureFlags.simSwapOnDemand) {
    notFound();
  }

  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return (
        <div className="min-h-screen flex flex-col">
          <Nav />
          <main
            id="main-content"
            className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
          >
            <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
              SIM-swap check
            </h1>
            <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
              Sign-in is temporarily unavailable. Please retry in a minute.
            </p>
          </main>
          <Footer />
        </div>
      );
    }
    throw err;
  }

  if (!user) {
    const params = await searchParams;
    const invite = params.invite
      ? `&invite=${encodeURIComponent(params.invite)}`
      : "";
    redirect(`/login?next=${encodeURIComponent("/sim-swap-check")}${invite}`);
  }

  const inBeta = await hasRedeemedSimSwapInvite(user.id);
  const params = await searchParams;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Check if your SIM has been swapped
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          A live check against Telstra&apos;s carrier records. Use it before
          a high-risk action — bank login, transferring funds, or any moment
          you&apos;re about to enter an SMS code.
        </p>

        <p className="text-xs uppercase tracking-wider text-slate-400 mb-8 text-center">
          Private beta · Telstra numbers only · 1 free check / month
        </p>

        {inBeta ? (
          <CheckFlow userEmail={user.email ?? ""} />
        ) : (
          <InviteForm prefilledCode={params.invite ?? ""} />
        )}

        <div className="mt-12 pt-6 border-t border-border-light">
          <p className="text-sm text-slate-500 leading-relaxed">
            We don&apos;t store your phone number in plaintext. The check uses
            Telstra&apos;s CAMARA SIM-Swap API and your consent is one-tap
            revocable from your account settings. Detected a swap? Call
            Telstra fraud on{" "}
            <a href="tel:132200" className="text-deep-navy font-semibold underline">
              132 200
            </a>{" "}
            and IDCARE on{" "}
            <a
              href="tel:1800595160"
              className="text-deep-navy font-semibold underline"
            >
              1800 595 160
            </a>
            .
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
