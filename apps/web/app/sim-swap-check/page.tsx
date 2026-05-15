// /sim-swap-check — private-beta web page for the on-demand SIM-swap
// check. Server component: handles flag gate, auth gate, and the
// invite-redemption state branch. Hands off the OTP + check flow to a
// client component once the user is admitted.
//
// Three states this page renders:
//
//   1. flag off                      → 404 (we don't even acknowledge it)
//   2. signed out                    → /login redirect with ?next=/sim-swap-check
//   3. signed in, no invite redeemed → InviteForm (redeem flow)
//   4. signed in, invite redeemed    → CheckFlow (verify number + run check)
//
// The OTP flow reuses the existing /api/phone-footprint/verify/{start,check}
// endpoints — they set the `pf:owner:{user}:{hash}` Upstash session key
// that /api/sim-swap/check reads. No duplication needed.

import { notFound, redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";
import { InviteForm } from "./InviteForm";
import { CheckFlow } from "./CheckFlow";

export const dynamic = "force-dynamic";

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
      // Auth is degraded — show a soft error rather than a hard 500.
      return (
        <main className="mx-auto max-w-2xl px-4 py-12">
          <h1 className="text-2xl font-semibold">SIM-swap check</h1>
          <p className="mt-4 text-sm text-amber-700">
            Sign-in is temporarily unavailable. Please retry in a minute.
          </p>
        </main>
      );
    }
    throw err;
  }

  if (!user) {
    const params = await searchParams;
    const invite = params.invite ? `&invite=${encodeURIComponent(params.invite)}` : "";
    redirect(`/login?next=${encodeURIComponent("/sim-swap-check")}${invite}`);
  }

  const inBeta = await hasRedeemedSimSwapInvite(user.id);
  const params = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Check if your SIM has been swapped
        </h1>
        <p className="mt-3 text-base text-stone-600">
          A live check against Telstra&apos;s carrier records. Use it before
          a high-risk action — bank login, transferring funds, or any moment
          you&apos;re about to enter an SMS code from your phone.
        </p>
        <p className="mt-3 text-xs uppercase tracking-wider text-stone-400">
          Private beta · Telstra numbers only · 1 free check / month
        </p>
      </header>

      {inBeta ? (
        <CheckFlow userEmail={user.email ?? ""} />
      ) : (
        <InviteForm prefilledCode={params.invite ?? ""} />
      )}

      <footer className="mt-12 border-t border-stone-200 pt-6 text-xs text-stone-500">
        <p>
          We don&apos;t store your phone number in plaintext. The check uses
          Telstra&apos;s CAMARA SIM-Swap API and your consent is one-tap
          revocable from your account settings. Detected a swap? Call
          Telstra fraud on{" "}
          <a href="tel:132200" className="underline">
            132 200
          </a>{" "}
          and IDCARE on{" "}
          <a href="tel:1800595160" className="underline">
            1800 595 160
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
