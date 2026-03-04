"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ApiKeyRecord {
  id: number;
  org_name: string;
  tier: string;
  daily_limit: number;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export default function KeyList({
  initialKeys,
}: {
  initialKeys: ApiKeyRecord[];
}) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [orgName, setOrgName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNewKey(null);
    setLoading(true);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName: orgName || "Personal" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate key");
        return;
      }

      setNewKey(data.key);
      setOrgName("");
      router.refresh();

      // Add the new key to local state
      if (data.record) {
        setKeys((prev) => [data.record, ...prev]);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function revokeKey(id: number) {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to revoke key");
        return;
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, is_active: false } : k))
      );
    } catch {
      setError("An unexpected error occurred");
    }
  }

  async function copyKey() {
    if (newKey) {
      await navigator.clipboard.writeText(newKey);
    }
  }

  const activeKeys = keys.filter((k) => k.is_active);
  const revokedKeys = keys.filter((k) => !k.is_active);

  return (
    <div className="space-y-6">
      {/* Generate form */}
      <form
        onSubmit={generateKey}
        className="rounded-xl border border-border-light bg-white p-5 space-y-3"
      >
        <h2 className="text-deep-navy font-extrabold text-sm">
          Generate API Key
        </h2>
        <div>
          <label
            htmlFor="orgName"
            className="block text-xs font-bold text-deep-navy mb-1"
          >
            Organisation name
          </label>
          <input
            id="orgName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            maxLength={100}
            className="w-full rounded-lg border border-border-light px-3 py-2 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-action-teal focus:border-transparent"
            placeholder="Personal"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-action-teal text-white font-bold text-sm px-4 py-2 hover:bg-action-teal/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Key"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* New key display */}
      {newKey && (
        <div className="rounded-xl border-2 border-action-teal bg-teal-50 p-5 space-y-3">
          <p className="text-deep-navy font-extrabold text-sm">
            Your new API key
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white rounded-lg border border-border-light px-3 py-2 text-xs font-mono text-deep-navy break-all select-all">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="rounded-lg border border-border-light bg-white px-3 py-2 text-xs font-bold text-deep-navy hover:bg-slate-50 transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-red-600 font-bold">
            Store this key securely. It will not be shown again.
          </p>
        </div>
      )}

      {/* Active keys */}
      {activeKeys.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-deep-navy font-extrabold text-sm">
            Active Keys ({activeKeys.length})
          </h2>
          {activeKeys.map((key) => (
            <KeyRow key={key.id} apiKey={key} onRevoke={revokeKey} />
          ))}
        </div>
      )}

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-gov-slate font-extrabold text-sm">
            Revoked Keys ({revokedKeys.length})
          </h2>
          {revokedKeys.map((key) => (
            <KeyRow key={key.id} apiKey={key} />
          ))}
        </div>
      )}

      {keys.length === 0 && (
        <p className="text-gov-slate text-sm text-center py-4">
          No API keys yet. Generate one above to get started.
        </p>
      )}
    </div>
  );
}

function KeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKeyRecord;
  onRevoke?: (id: number) => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        apiKey.is_active ? "border-border-light" : "border-border-light opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-deep-navy font-bold text-sm">
          {apiKey.org_name}
        </span>
        <span
          className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
            apiKey.is_active
              ? "bg-teal-50 text-action-teal"
              : "bg-slate-100 text-gov-slate"
          }`}
        >
          {apiKey.is_active ? apiKey.tier : "revoked"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-gov-slate">
        <span>
          {apiKey.daily_limit} req/day
          {apiKey.last_used_at &&
            ` · Last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
        </span>
        {apiKey.is_active && onRevoke && (
          <button
            onClick={() => onRevoke(apiKey.id)}
            className="text-red-500 font-bold hover:text-red-700 transition-colors"
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
