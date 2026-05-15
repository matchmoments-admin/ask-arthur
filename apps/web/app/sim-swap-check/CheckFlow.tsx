"use client";

import { useEffect, useState } from "react";
import { Smartphone, ShieldCheck, AlertTriangle, Phone, CheckCircle2 } from "lucide-react";

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
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [showPurchaseBanner, setShowPurchaseBanner] = useState(false);
  const [buyBusy, setBuyBusy] = useState(false);

  useEffect(() => {
    // Stripe Checkout success_url is `/sim-swap-check?credits=ok`. Clear
    // the query and surface a confirmation banner — the webhook may still
    // be processing, so we tell the user that explicitly rather than
    // optimistically incrementing a local count.
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("credits") === "ok") {
      setShowPurchaseBanner(true);
      window.history.replaceState({}, "", "/sim-swap-check");
    }
  }, []);

  async function buyFivePack() {
    setBuyBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch("/api/sim-swap/credits/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack: "sim_swap_credits_5pack" }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(
          body.error === "not_configured"
            ? "Credit purchases aren't configured yet. Contact support."
            : `Couldn't start checkout (HTTP ${res.status}).`,
        );
        return;
      }
      window.location.assign(body.url);
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setBuyBusy(false);
    }
  }

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
    setErrorCode(null);
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
        setErrorCode(typeof body.error === "string" ? body.error : null);
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

  function resetToReady() {
    setResult(null);
    setError(null);
    setErrorCode(null);
    setStage("ready");
  }

  // Helper: wrap any stage with the post-purchase banner if needed.
  const banner = showPurchaseBanner ? (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 flex items-start gap-3 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-sm text-[#1B5E20]"
    >
      <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden />
      <p>
        <span className="font-semibold">Credits added.</span> Your purchase is
        being processed — refresh in a few seconds if your balance doesn&apos;t
        update yet.
      </p>
    </div>
  ) : null;

  // Inline "buy 5-pack" CTA when the user just hit no_credits.
  const buyCta =
    errorCode === "no_credits" ? (
      <button
        type="button"
        onClick={buyFivePack}
        disabled={buyBusy}
        className="rounded-lg bg-deep-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-navy transition-colors"
      >
        {buyBusy ? "Opening checkout…" : "Buy 5 checks — $0.99"}
      </button>
    ) : null;

  const stageContent =
    stage === "phone" ? (
      <FormCard
        icon={<Smartphone size={22} className="text-deep-navy shrink-0 mt-1" />}
        title="Step 1 — enter your Telstra mobile"
        subtitle={`Signed in as ${userEmail}. We'll send a 6-digit code to confirm you own this number.`}
      >
        <form onSubmit={startVerify} className="mt-6 flex flex-col gap-3">
          <label
            className="text-sm font-medium text-deep-navy"
            htmlFor="msisdn"
          >
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
            className="rounded-lg border border-border-light px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-deep-navy"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "phone-error" : undefined}
          />
          <ErrorLine id="phone-error" message={error} />
          {buyCta}
          <button
            type="submit"
            disabled={busy || msisdn.length < 8}
            className="rounded-lg bg-deep-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-navy transition-colors"
          >
            {busy ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      </FormCard>
    ) : stage === "otp" ? (
      <FormCard
        icon={<Smartphone size={22} className="text-deep-navy shrink-0 mt-1" />}
        title="Step 2 — enter the 6-digit code"
        subtitle={`Sent to ${msisdn}. Codes expire in 10 minutes.`}
      >
        <form onSubmit={submitOtp} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium text-deep-navy" htmlFor="otp">
            Verification code
          </label>
          <input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="123 456"
            className="rounded-lg border border-border-light px-3 py-2.5 text-base font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-deep-navy"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "otp-error" : undefined}
          />
          <ErrorLine id="otp-error" message={error} />
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className="rounded-lg bg-deep-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-navy transition-colors"
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
            className="text-xs text-slate-500 underline self-start"
          >
            Use a different number
          </button>
        </form>
      </FormCard>
    ) : stage === "ready" ? (
      <FormCard
        icon={
          <ShieldCheck size={22} className="text-deep-navy shrink-0 mt-1" />
        }
        title="Step 3 — run the SIM-swap check"
        subtitle={`We'll ask Telstra whether ${msisdn} was swapped in the last 72 hours.`}
      >
        <div className="mt-6 flex flex-col gap-3">
          <ErrorLine id="check-error" message={error} />
          {buyCta}
          <button
            type="button"
            onClick={runCheck}
            disabled={busy}
            className="w-full rounded-lg bg-deep-navy px-4 py-3 text-base font-semibold text-white disabled:opacity-50 hover:bg-navy transition-colors"
          >
            {busy ? "Checking…" : "Check my SIM now"}
          </button>
        </div>
      </FormCard>
    ) : result ? (
      result.swapped ? (
        <RedCard result={result} msisdn={msisdn} onAgain={resetToReady} />
      ) : (
        <GreenCard result={result} msisdn={msisdn} onAgain={resetToReady} />
      )
    ) : null;

  return (
    <>
      {banner}
      {stageContent}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components

function FormCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-light bg-white p-6 sm:p-8">
      <div className="flex items-start gap-4">
        {icon}
        <div className="flex-1">
          <h2 className="font-semibold text-deep-navy">{title}</h2>
          <p className="text-sm text-gov-slate mt-1 leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ErrorLine({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-[#B71C1C]">
      {message}
    </p>
  );
}

// SAFE verdict — design-system colors from DESIGN_SYSTEM.md
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
    <section
      role="status"
      aria-live="polite"
      className="rounded-xl border-2 border-[#A7F3D0] bg-[#ECFDF5] p-6 sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[#388E3C]">
        ✓ Safe to proceed
      </p>
      <h2 className="mt-2 text-2xl md:text-3xl font-extrabold text-[#1B5E20] leading-tight">
        No SIM swap in the last {result.maxAgeHoursChecked} hours
      </h2>
      <p className="mt-3 text-sm text-[#388E3C] leading-relaxed">
        Telstra reports no SIM change on {msisdn} within the lookback window.
        SMS verification codes sent to this number should still reach you.
      </p>
      {result.latestSimChange ? (
        <p className="mt-3 text-xs text-[#388E3C]">
          Most recent SIM change on record:{" "}
          {formatDate(result.latestSimChange)}
        </p>
      ) : null}
      <CreditFooter result={result} onAgain={onAgain} variant="safe" />
    </section>
  );
}

// HIGH_RISK verdict — design-system colors
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
    <section
      role="alert"
      aria-live="assertive"
      className="rounded-xl border-2 border-[#FECACA] bg-[#FEF2F2] p-6 sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[#D32F2F] flex items-center gap-2">
        <AlertTriangle size={16} aria-hidden /> Stop — do not enter SMS codes
      </p>
      <h2 className="mt-2 text-2xl md:text-3xl font-extrabold text-[#B71C1C] leading-tight">
        SIM swap detected in the last {result.maxAgeHoursChecked} hours
      </h2>
      <p className="mt-3 text-sm text-[#D32F2F] leading-relaxed">
        Telstra reports a SIM change on {msisdn} within the lookback window.
        Any SMS code being sent to this number may be reaching someone else.
      </p>
      {result.latestSimChange ? (
        <p className="mt-2 text-xs text-[#D32F2F]">
          Last SIM change: {formatDate(result.latestSimChange)}
        </p>
      ) : null}

      <div className="mt-5 rounded-lg border border-[#FECACA] bg-white p-4">
        <h3 className="text-sm font-semibold text-[#B71C1C]">Do this now:</h3>
        <ol className="mt-3 space-y-2 text-sm text-gov-slate list-decimal pl-5">
          <li>
            <a
              className="font-semibold text-[#B71C1C] underline inline-flex items-center gap-1"
              href="tel:132200"
            >
              <Phone size={12} aria-hidden /> Call Telstra fraud on 132 200
            </a>{" "}
            to deactivate the rogue SIM.
          </li>
          <li>Call your bank&apos;s fraud line from a different phone.</li>
          <li>
            <a
              className="font-semibold text-[#B71C1C] underline inline-flex items-center gap-1"
              href="tel:1800595160"
            >
              <Phone size={12} aria-hidden /> Contact IDCARE on 1800 595 160
            </a>{" "}
            for identity-recovery support.
          </li>
          <li>
            Report to ReportCyber at{" "}
            <a
              className="text-deep-navy underline"
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

      <CreditFooter result={result} onAgain={onAgain} variant="risk" />
    </section>
  );
}

function CreditFooter({
  result,
  onAgain,
  variant,
}: {
  result: CheckResult;
  onAgain: () => void;
  variant: "safe" | "risk";
}) {
  const remaining =
    result.creditsRemaining.free + result.creditsRemaining.paid;
  const dividerClass =
    variant === "safe" ? "border-[#A7F3D0]" : "border-[#FECACA]";
  const textClass = variant === "safe" ? "text-[#388E3C]" : "text-[#D32F2F]";
  const btnClass =
    variant === "safe"
      ? "border-[#A7F3D0] text-[#1B5E20]"
      : "border-[#FECACA] text-[#B71C1C]";
  return (
    <div
      className={`mt-6 flex items-center justify-between border-t pt-4 text-xs ${dividerClass}`}
    >
      <p className={textClass}>
        Used 1 {result.consumedBucket} credit. {remaining} left.
      </p>
      <button
        type="button"
        onClick={onAgain}
        className={`rounded-md border bg-white px-3 py-1.5 ${btnClass} hover:bg-white/70 transition-colors`}
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

function checkError(
  body: { error?: string; detail?: unknown },
  status: number,
): string {
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
