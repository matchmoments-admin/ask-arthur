"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import type {
  DestinationOption,
  OnwardResultRow,
  EvidenceContext,
} from "@/lib/onward/destinations";
import OnwardReportSummary from "./OnwardReportSummary";

interface Props {
  scamReportId: number;
  analysisId?: string;
  scamType?: string;
  impersonatedBrand?: string;
  channel?: string;
  hasFinancialLoss?: boolean;
  hasPiiCompromise?: boolean;
  evidence: EvidenceContext;
  onClose?: () => void;
}

/**
 * The destination picker shown when the user clicks "Report this scam".
 * Loads the dynamic destination list from /api/report/destinations and
 * lets the user untick any. Submits to /api/report/onward and swaps to
 * OnwardReportSummary on success.
 */
export default function OnwardReportPicker({
  scamReportId,
  analysisId,
  scamType,
  impersonatedBrand,
  channel,
  hasFinancialLoss,
  hasPiiCompromise,
  evidence,
  onClose,
}: Props) {
  const [destinations, setDestinations] = useState<DestinationOption[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<OnwardResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      ...(scamType ? { scamType } : {}),
      ...(impersonatedBrand ? { impersonatedBrand } : {}),
      ...(channel ? { channel } : {}),
      hasFinancialLoss: String(!!hasFinancialLoss),
      hasPiiCompromise: String(!!hasPiiCompromise),
    });
    fetch(`/api/report/destinations?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        const dests: DestinationOption[] = d.destinations ?? [];
        setDestinations(dests);
        const initial: Record<string, boolean> = {};
        for (const opt of dests) {
          initial[`${opt.destination}:${opt.destination_key}`] = opt.default_enabled;
        }
        setSelected(initial);
      })
      .catch((err) => setError(String(err)));
  }, [scamType, impersonatedBrand, channel, hasFinancialLoss, hasPiiCompromise]);

  async function send() {
    if (!destinations) return;
    setSubmitting(true);
    setError(null);
    try {
      const picks = destinations
        .filter((d) => selected[`${d.destination}:${d.destination_key}`])
        .map((d) => ({
          destination: d.destination,
          destination_key: d.destination_key,
        }));
      if (picks.length === 0) {
        setError("Pick at least one destination, or close this panel.");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/report/onward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scam_report_id: scamReportId,
          analysis_id: analysisId,
          selected: picks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setResults(data.results as OnwardResultRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (results) {
    return <OnwardReportSummary results={results} evidence={evidence} />;
  }

  if (!destinations) {
    return (
      <section className="mt-6 rounded-2xl border border-border-light bg-white p-5">
        <div className="flex items-center gap-3 text-gov-slate text-sm">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Loading reporting options…
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-border-light bg-white p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-bold text-deep-navy text-base">
            Where should we send this?
          </h3>
          <p className="text-sm text-gov-slate mt-1">
            We&apos;ll forward the details to each place you tick. Untick anything
            you&apos;d rather handle yourself.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report picker"
            className="text-gov-slate hover:text-deep-navy"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {destinations.map((d) => {
          const k = `${d.destination}:${d.destination_key}`;
          const on = !!selected[k];
          return (
            <li
              key={k}
              className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                on
                  ? "border-action-teal bg-action-teal/5"
                  : "border-border-light bg-white"
              }`}
            >
              <input
                id={`dest-${k}`}
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  setSelected((s) => ({ ...s, [k]: e.target.checked }))
                }
                className="mt-1"
              />
              <label htmlFor={`dest-${k}`} className="flex-1 cursor-pointer">
                <span className="block font-semibold text-deep-navy text-sm">
                  {d.display_name}
                </span>
                <span className="block text-xs text-gov-slate mt-0.5">
                  {d.description}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-gov-slate">
        Reports to Scamwatch help build a national picture, but they&apos;re{" "}
        <strong>not a police report</strong>. If you&apos;ve lost money or had
        your identity stolen, also report it to ReportCyber.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold text-gov-slate hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={send}
          disabled={submitting}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-deep-navy px-6 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            <>
              <Check size={16} aria-hidden="true" />
              Send report
            </>
          )}
        </button>
      </div>
    </section>
  );
}
