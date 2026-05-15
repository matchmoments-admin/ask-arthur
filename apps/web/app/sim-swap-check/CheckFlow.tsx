"use client";

import { useState } from "react";

type Stage = "phone" | "otp" | "ready" | "result";

interface CheckResult {
  swapped: boolean;
  latestSimChange: string | null;
  monitoredPeriod: number;
  maxAgeHoursChecked: number;
  recommendedAction: "stop" | "proceed";
  consumedBucket: "free" | "paid";
  creditsRemaining: { free: number; paid: number };
}

interface CheckFlowProps {
  userEmail: string;
}

export function CheckFlow({ userEmail }: CheckFlowProps) {
  const [stage, setStage] = useState<Stage>("phone");
  const [msisdn, setMsisdn] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function startVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/phone-footprint/verify/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msisdn }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(verifyError(body.error, res.status));
        return;
      }
      setStage("otp");
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/phone-footprint/verify/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msisdn, code: otp }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(verifyError(body.error, res.status));
        return;
      }
      setStage("ready");
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/sim-swap/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msisdn, maxAge: 72 }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(checkError(body, res.status));
        return;
      }
      setResult(body as CheckResult);
      setStage("result");
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "phone") {
    return (
      <FormCard
        title="Step 1 — enter your Telstra mobile"
        subtitle={`Signed in as ${userEmail}. We'll send a 6-digit code to confirm you own this number.`}
      >
        <form onSubmit={startVerify} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="msisdn">
            Mobile number
          </label>
          <input
            id="msisdn"
            inputMode="tel"
            autoComplete="tel"
            required
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            placeholder="+61 4XX XXX XXX"
            className="rounded-md border border-stone-300 px-3 py-2 text-base"
          />
          <ErrorLine message={error} />
          <button
            type="submit"
            disabled={busy || msisdn.length < 8}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      </FormCard>
    );
  }

  if (stage === "otp") {
    return (
      <FormCard
        title="Step 2 — enter the 6-digit code"
        subtitle={`Sent to ${msisdn}. Codes expire in 10 minutes.`}
      >
        <form onSubmit={submitOtp} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="otp">
            Verification code
          </label>
          <input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123 456"
            className="rounded-md border border-stone-300 px-3 py-2 text-base font-mono tracking-widest"
          />
          <ErrorLine message={error} />
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("phone");
              setOtp("");
              setError(null);
            }}
            className="text-xs text-stone-500 underline"
          >
            Use a different number
          </button>
        </form>
      </FormCard>
    );
  }

  if (stage === "ready") {
    return (
      <FormCard
        title="Step 3 — run the SIM-swap check"
        subtitle={`We'll ask Telstra whether ${msisdn} was swapped in the last 72 hours.`}
      >
        <ErrorLine message={error} />
        <button
          type="button"
          onClick={runCheck}
          disabled={busy}
          className="w-full rounded-md bg-stone-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check my SIM now"}
        </button>
      </FormCard>
    );
  }

  // stage === "result"
  if (!result) return null;
  return result.swapped ? (
    <RedCard result={result} msisdn={msisdn} onAgain={resetToReady} />
  ) : (
    <GreenCard result={result} msisdn={msisdn} onAgain={resetToReady} />
  );

  function resetToReady() {
    setResult(null);
    setError(null);
    setStage("ready");
  }
}

// ---------------------------------------------------------------------------
// Sub-components

function FormCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50 p-6">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm text-stone-600">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-rose-700">
      {message}
    </p>
  );
}

function GreenCard({
  result,
  msisdn,
  onAgain,
}: {
  result: CheckResult;
  msisdn: string;
  onAgain: () => void;
}) {
  return (
    <section className="rounded-lg border-2 border-emerald-600 bg-emerald-50 p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
        ✅ Safe to proceed
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-emerald-900">
        No SIM swap in the last {result.maxAgeHoursChecked} hours
      </h2>
      <p className="mt-3 text-sm text-emerald-900">
        Telstra reports no SIM change on {msisdn} within the lookback window.
        SMS verification codes sent to this number should still reach you.
      </p>
      {result.latestSimChange ? (
        <p className="mt-3 text-xs text-emerald-700">
          Most recent SIM change on record: {formatDate(result.latestSimChange)}
        </p>
      ) : null}
      <CreditFooter result={result} onAgain={onAgain} />
    </section>
  );
}

function RedCard({
  result,
  msisdn,
  onAgain,
}: {
  result: CheckResult;
  msisdn: string;
  onAgain: () => void;
}) {
  return (
    <section className="rounded-lg border-2 border-rose-700 bg-rose-50 p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
        🚨 Stop — do not enter SMS codes
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-rose-900">
        SIM swap detected in the last {result.maxAgeHoursChecked} hours
      </h2>
      <p className="mt-3 text-sm text-rose-900">
        Telstra reports a SIM change on {msisdn} within the lookback window.
        Any SMS code being sent to this number may be reaching someone else.
      </p>
      {result.latestSimChange ? (
        <p className="mt-2 text-xs text-rose-700">
          Last SIM change: {formatDate(result.latestSimChange)}
        </p>
      ) : null}

      <div className="mt-4 rounded-md border border-rose-300 bg-white p-4">
        <h3 className="text-sm font-semibold text-rose-900">
          Do this now:
        </h3>
        <ol className="mt-2 space-y-2 text-sm text-rose-900">
          <li>
            Call Telstra fraud on{" "}
            <a className="font-semibold underline" href="tel:132200">
              132 200
            </a>{" "}
            to deactivate the rogue SIM.
          </li>
          <li>
            Call your bank&apos;s fraud line from a different phone if
            possible.
          </li>
          <li>
            Contact IDCARE on{" "}
            <a className="font-semibold underline" href="tel:1800595160">
              1800 595 160
            </a>{" "}
            for identity-recovery support.
          </li>
          <li>
            Report to ReportCyber at{" "}
            <a
              className="underline"
              href="https://www.cyber.gov.au/report-and-recover/report"
              target="_blank"
              rel="noreferrer"
            >
              cyber.gov.au/report
            </a>
            .
          </li>
        </ol>
      </div>

      <CreditFooter result={result} onAgain={onAgain} />
    </section>
  );
}

function CreditFooter({
  result,
  onAgain,
}: {
  result: CheckResult;
  onAgain: () => void;
}) {
  const remaining = result.creditsRemaining.free + result.creditsRemaining.paid;
  return (
    <div className="mt-6 flex items-center justify-between border-t border-stone-300 pt-4 text-xs text-stone-600">
      <p>
        Used 1 {result.consumedBucket} credit. {remaining} left.
      </p>
      <button
        type="button"
        onClick={onAgain}
        className="rounded-md border border-stone-400 px-3 py-1 text-stone-700"
      >
        Run another check
      </button>
    </div>
  );
}

function verifyError(code: string | undefined, status: number): string {
  switch (code) {
    case "feature_disabled":
      return "Phone verification isn't enabled yet.";
    case "rate_limited":
      return "Too many verification attempts. Wait a moment and try again.";
    case "invalid_msisdn":
      return "That doesn't look like a valid mobile number.";
    default:
      return `Verification failed (HTTP ${status}).`;
  }
}

function checkError(body: { error?: string; detail?: unknown }, status: number): string {
  switch (body.error) {
    case "ownership_not_verified":
      return "We lost your verification session. Please verify the number again.";
    case "no_credits":
      return "You've used your monthly free check. Buy a 5-pack for $0.99 to keep going.";
    case "rate_limited":
      return "Slow down — wait a minute before trying again.";
    case "cost_brake_active":
      return "The SIM-swap service is paused temporarily due to a daily cost cap. Try again in an hour.";
    case "telstra_unavailable":
      return "Telstra didn't respond. Your credit has been refunded. Please try again in a minute.";
    case "carrier_not_covered":
      return "This number doesn't appear to be on Telstra. The check is only available for Telstra subscribers today.";
    case "invite_required":
      return "You don't have an active invite to the SIM-swap beta.";
    default:
      return `Check failed (HTTP ${status}).`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
