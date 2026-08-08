"use client";

import { useState } from "react";

// Pilot-brand onboarding form (#953). The first monitored_brands row used to
// mean hand-writing SQL — on the day a pilot converts, which is the worst
// possible moment to typo a join key.

const PLANS = [
  { value: "brand_pilot", label: "Brand pilot (A$300/mo, first month free)" },
  { value: "brand_monitor", label: "Brand Monitor" },
  { value: "brand_monitor_plus", label: "Brand Monitor Plus" },
  { value: "brand_enterprise", label: "Enterprise" },
] as const;

export default function BrandOnboardForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [brandName, setBrandName] = useState("");
  const [domains, setDomains] = useState("");
  const [aliases, setAliases] = useState("");
  const [plan, setPlan] = useState<string>("brand_pilot");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const parseList = (raw: string) =>
    raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const legitimateDomains = parseList(domains).map((d) => d.toLowerCase());
    if (!brandName.trim() || legitimateDomains.length === 0) {
      setMsg({ kind: "err", text: "Brand name and at least one legitimate domain are required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          brandName: brandName.trim(),
          legitimateDomains,
          aliases: parseList(aliases),
          plan,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          kind: "err",
          text:
            json.error === "already_monitored"
              ? "That brand is already monitored for this org."
              : `Failed: ${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`,
        });
        return;
      }
      setMsg({
        kind: "ok",
        text: `Created "${json.brand.brand_name}" (key: ${json.brand.brand_normalized}) — status ${json.brand.verification_status}. Verify it before it goes live.`,
      });
      setBrandName("");
      setDomains("");
      setAliases("");
    } catch {
      setMsg({ kind: "err", text: "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 max-w-2xl space-y-3 rounded-xl border border-border-light bg-white p-5">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gov-slate">Brand name</label>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. Airwallex"
          className="mt-1 w-full rounded border border-border-light px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gov-slate">
          Legitimate domains <span className="font-normal normal-case text-slate-400">— the brand&rsquo;s OWN sites, so they never surface as lookalikes of themselves</span>
        </label>
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={3}
          placeholder="airwallex.com&#10;airwallex.com.au"
          className="mt-1 w-full rounded border border-border-light px-3 py-2 font-mono text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gov-slate">
          Aliases <span className="font-normal normal-case text-slate-400">— optional, one per line</span>
        </label>
        <textarea value={aliases} onChange={(e) => setAliases(e.target.value)} rows={2}
          className="mt-1 w-full rounded border border-border-light px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gov-slate">Plan</label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)}
          className="mt-1 w-full rounded border border-border-light px-3 py-2 text-sm">
          {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <p className="text-xs text-gov-slate">
        Org: <code className="font-mono">{orgName}</code>. Created rows start{" "}
        <strong>pending verification</strong> — the matcher only covers verified + active
        brands, so nothing goes live until it&rsquo;s verified.
      </p>
      <button type="submit" disabled={busy}
        className="rounded-lg bg-deep-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy disabled:opacity-50">
        {busy ? "Creating…" : "Onboard brand"}
      </button>
      {msg && (
        <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-danger-text"}`}>{msg.text}</p>
      )}
    </form>
  );
}
