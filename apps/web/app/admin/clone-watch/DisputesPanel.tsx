"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DisputeRow {
  id: string;
  subject_type: "brand" | "registrar";
  subject: string;
  disputant: string | null;
  claim: string;
  resolution: "pending" | "corrected" | "upheld" | "withdrawn";
  created_at: string;
  resolved_at: string | null;
}

const RESOLUTIONS = ["corrected", "upheld", "withdrawn"] as const;

const RESOLUTION_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  corrected: "bg-emerald-100 text-emerald-800",
  upheld: "bg-slate-200 text-slate-700",
  withdrawn: "bg-slate-100 text-slate-500",
};

export default function DisputesPanel({ disputes }: { disputes: DisputeRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [subjectType, setSubjectType] = useState<"brand" | "registrar">("brand");
  const [subject, setSubject] = useState("");
  const [disputant, setDisputant] = useState("");
  const [claim, setClaim] = useState("");
  const [error, setError] = useState("");

  async function logDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !claim.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/clone-watch/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType,
          subject: subject.trim(),
          disputant: disputant.trim() || undefined,
          claim: claim.trim(),
        }),
      });
      if (!res.ok) throw new Error(`log failed (${res.status})`);
      setSubject("");
      setDisputant("");
      setClaim("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "log failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, resolution: (typeof RESOLUTIONS)[number]) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/clone-watch/dispute", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, resolution }),
      });
      if (!res.ok) throw new Error(`resolve failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "resolve failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-deep-navy">Disputes ledger</h2>
        <span className="ml-auto text-[11px] text-slate-400">
          {disputes.filter((d) => d.resolution === "pending").length} open ·{" "}
          {disputes.length} total
        </span>
      </div>

      <form onSubmit={logDispute} className="px-5 py-4 border-b border-slate-100 grid gap-2 md:grid-cols-[120px_1fr_1fr] items-start">
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value as "brand" | "registrar")}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="brand">Brand</option>
          <option value="registrar">Registrar</option>
        </select>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (e.g. hesta.com.au or Dynadot)"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={disputant}
          onChange={(e) => setDisputant(e.target.value)}
          placeholder="Disputant (optional)"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Claim / what they dispute"
          rows={2}
          className="md:col-span-3 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="md:col-span-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !subject.trim() || !claim.trim()}
            className="rounded bg-deep-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Log dispute
          </button>
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </form>

      {disputes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-400">No disputes logged.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50">
                <th className="text-left px-5 py-2">Subject</th>
                <th className="text-left px-3 py-2">Claim</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-5 py-2">Resolve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-2 align-top">
                    <span className="font-medium text-deep-navy">{d.subject}</span>
                    <span className="ml-1 text-[10px] uppercase text-slate-400">{d.subject_type}</span>
                    {d.disputant && <div className="text-[11px] text-slate-500">{d.disputant}</div>}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-600 max-w-md">{d.claim}</td>
                  <td className="px-3 py-2 align-top">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${RESOLUTION_STYLE[d.resolution]}`}>
                      {d.resolution}
                    </span>
                  </td>
                  <td className="px-5 py-2 align-top text-right">
                    {d.resolution === "pending" ? (
                      <div className="inline-flex gap-1">
                        {RESOLUTIONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => resolve(d.id, r)}
                            disabled={busy}
                            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
