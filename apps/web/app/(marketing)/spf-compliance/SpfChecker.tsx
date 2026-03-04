"use client";

import { useState } from "react";
import { Shield, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface CheckResult {
  spf: { found: boolean; record?: string; valid?: boolean };
  dmarc: { found: boolean; record?: string; policy?: string };
  dkim: { found: boolean };
}

export function SpfChecker() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) return;

    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
      setError("Please enter a valid domain (e.g., example.com.au)");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/site-audit/email-security?domain=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        setError("Check failed. Please try again.");
        return;
      }
      const data = await res.json();
      setResult(data);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl card-shadow p-8">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="text-deep-navy" size={24} />
        <h2 className="text-xl font-semibold text-deep-navy">
          Email Security Check
        </h2>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Enter your domain (e.g., example.com.au)"
          className="flex-1 rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-deep-navy placeholder:text-slate-400 focus:bg-white transition-colors"
          onKeyDown={(e) => e.key === "Enter" && handleCheck()}
          disabled={loading}
        />
        <button
          onClick={handleCheck}
          disabled={loading || !domain.trim()}
          className="px-6 py-3 bg-deep-navy text-white font-semibold rounded-xl hover:bg-navy transition-colors disabled:opacity-50 text-sm"
        >
          {loading ? "Checking..." : "Check"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
          <XCircle size={16} />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <ResultRow
            label="SPF Record"
            found={result.spf.found}
            detail={result.spf.record}
            valid={result.spf.valid}
          />
          <ResultRow
            label="DMARC Policy"
            found={result.dmarc.found}
            detail={result.dmarc.record}
            valid={result.dmarc.policy !== "none"}
          />
          <ResultRow
            label="DKIM Selector"
            found={result.dkim.found}
            detail={result.dkim.found ? "DKIM signing detected" : undefined}
            valid={result.dkim.found}
          />
        </div>
      )}
    </div>
  );
}

function ResultRow({
  label,
  found,
  detail,
  valid,
}: {
  label: string;
  found: boolean;
  detail?: string;
  valid?: boolean;
}) {
  const Icon = !found ? XCircle : valid ? CheckCircle : AlertTriangle;
  const color = !found ? "text-red-600" : valid ? "text-green-600" : "text-amber-500";
  const bg = !found ? "bg-red-50" : valid ? "bg-green-50" : "bg-amber-50";

  return (
    <div className={`${bg} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className={color} />
        <span className={`font-semibold text-sm ${color}`}>{label}</span>
        <span className={`text-xs ${color}`}>
          {!found ? "Not Found" : valid ? "Configured" : "Needs Attention"}
        </span>
      </div>
      {detail && (
        <p className="text-xs text-gov-slate font-mono mt-1 break-all">
          {detail}
        </p>
      )}
    </div>
  );
}
