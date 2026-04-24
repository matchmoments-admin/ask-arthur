"use client";

// Saved-numbers client component. Renders the list and handles three
// in-line interactions: add monitor (OTP-gated), pause/resume, delete.
// Keeps the OTP step in-page rather than redirecting to a dedicated
// verify route — the user is already authed and the friction of a
// separate page hurts the upsell flow.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BandBadge } from "@/components/phone-footprint/BandBadge";

type Cadence = "daily" | "weekly" | "monthly";

interface FootprintMini {
  id: number;
  composite_score: number;
  band: string;
  generated_at: string;
}

interface MonitorRow {
  id: number;
  msisdn_e164: string;
  alias: string | null;
  refresh_cadence: string;
  alert_threshold: number;
  last_refreshed_at: string | null;
  next_refresh_at: string;
  status: string;
  created_at: string;
  latest_footprint: FootprintMini | null;
  alerts_30d: number;
}

interface Props {
  monitors: MonitorRow[];
  savedNumbersLimit: number;
  refreshCadenceMin: Cadence;
}

export function MonitorsClient({ monitors, savedNumbersLimit, refreshCadenceMin }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const atCap = monitors.length >= savedNumbersLimit;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Your monitors</h2>
        <button
          onClick={() => setShowAdd(true)}
          disabled={atCap}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          title={atCap ? `You've reached your limit of ${savedNumbersLimit}.` : "Add a number"}
        >
          + Add number
        </button>
      </div>

      {monitors.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {monitors.map((m) => (
            <MonitorRow key={m.id} monitor={m} onChange={() => router.refresh()} />
          ))}
        </ul>
      )}

      {showAdd && (
        <AddMonitorModal
          refreshCadenceMin={refreshCadenceMin}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
      <p className="text-sm text-gray-700">
        No saved numbers yet. Add your first to start receiving alerts when
        anything changes — new breach exposure, SIM swap, scam-report bumps,
        and more.
      </p>
    </div>
  );
}

function MonitorRow({
  monitor,
  onChange,
}: {
  monitor: MonitorRow;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fp = monitor.latest_footprint;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/phone-footprint/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    onChange();
  }
  async function remove() {
    if (!confirm(`Remove ${monitor.msisdn_e164}? Alerts history is kept for audit.`))
      return;
    setBusy(true);
    await fetch(`/api/phone-footprint/monitors/${monitor.id}`, { method: "DELETE" });
    setBusy(false);
    onChange();
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 tabular-nums">
            {monitor.msisdn_e164}
          </span>
          {monitor.alias && <span className="text-sm text-gray-500">· {monitor.alias}</span>}
          {monitor.status === "paused" && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Paused
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          Refresh {monitor.refresh_cadence} · Last refreshed{" "}
          {monitor.last_refreshed_at
            ? new Date(monitor.last_refreshed_at).toLocaleDateString()
            : "never"}{" "}
          · {monitor.alerts_30d} alert{monitor.alerts_30d === 1 ? "" : "s"} in 30d
        </div>
      </div>
      <div className="flex items-center gap-3">
        {fp && (
          <BandBadge
            score={fp.composite_score}
            band={fp.band as "safe" | "caution" | "high" | "critical"}
            compact
          />
        )}
        <button
          disabled={busy}
          onClick={() =>
            patch({ status: monitor.status === "paused" ? "active" : "paused" })
          }
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
        >
          {monitor.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button
          disabled={busy}
          onClick={remove}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function AddMonitorModal({
  refreshCadenceMin,
  onClose,
  onCreated,
}: {
  refreshCadenceMin: Cadence;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<"phone" | "otp" | "creating">("phone");
  const [msisdn, setMsisdn] = useState("");
  const [alias, setAlias] = useState("");
  const [cadence, setCadence] = useState<Cadence>(refreshCadenceMin);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function startVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await fetch("/api/phone-footprint/verify/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msisdn }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setError(body?.error ?? "verify_start_failed");
      return;
    }
    setStep("otp");
  }

  async function checkAndCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const checkR = await fetch("/api/phone-footprint/verify/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msisdn, code }),
    });
    if (!checkR.ok) {
      setError("verify_check_failed");
      return;
    }
    const checkBody = await checkR.json();
    if (!checkBody.approved) {
      setError("Wrong code — try again.");
      return;
    }

    setStep("creating");
    const createR = await fetch("/api/phone-footprint/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msisdn,
        alias: alias || undefined,
        refresh_cadence: cadence,
      }),
    });
    if (!createR.ok) {
      const body = await createR.json().catch(() => ({}));
      setError(body?.error ?? "create_failed");
      setStep("otp");
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg text-gray-900">Add saved number</h3>
          <button onClick={onClose} className="text-gray-500" aria-label="Close">
            ×
          </button>
        </header>

        {step === "phone" && (
          <form onSubmit={startVerify} className="space-y-3">
            <label className="block text-xs font-medium tracking-wider uppercase text-gray-700">
              Phone number
              <input
                type="tel"
                required
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                placeholder="+61412345678 or 0412 345 678"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
              />
            </label>
            <label className="block text-xs font-medium tracking-wider uppercase text-gray-700">
              Label (optional)
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Mum's mobile"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
              />
            </label>
            <label className="block text-xs font-medium tracking-wider uppercase text-gray-700">
              Refresh cadence
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Cadence)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
              >
                {refreshCadenceMin === "daily" && <option value="daily">Daily</option>}
                {(refreshCadenceMin === "daily" || refreshCadenceMin === "weekly") && (
                  <option value="weekly">Weekly</option>
                )}
                <option value="monthly">Monthly</option>
              </select>
            </label>

            {error && <p className="text-sm text-red-700">{error}</p>}
            <p className="text-xs text-gray-500">
              We&rsquo;ll send a one-time SMS code to verify you control this
              number — Ask Arthur only monitors numbers their owners ask us to.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Send code
              </button>
            </div>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={checkAndCreate} className="space-y-3">
            <p className="text-sm text-gray-700">
              Enter the 6-digit code sent to <strong>{msisdn}</strong>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              required
              autoFocus
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-xl tracking-widest tabular-nums"
            />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              >
                Back
              </button>
              <button
                type="submit"
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Verify & save
              </button>
            </div>
          </form>
        )}

        {step === "creating" && (
          <div className="py-6 text-center text-sm text-gray-600">
            Creating monitor…
          </div>
        )}
      </div>
    </div>
  );
}
