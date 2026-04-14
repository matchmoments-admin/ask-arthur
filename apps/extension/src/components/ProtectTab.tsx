import { useState, useEffect } from "react";
import { Shield, ShieldCheck, ExternalLink, Eye, ShieldOff } from "lucide-react";

interface AdStats {
  checked: number;
  blocked: number;
}

export function ProtectTab() {
  const [stats, setStats] = useState<AdStats | null>(null);

  useEffect(() => {
    chrome.storage.session
      .get("arthur-ad-stats")
      .then((result) => {
        const data = result["arthur-ad-stats"] as AdStats | undefined;
        if (data) setStats(data);
      })
      .catch(() => {
        // Storage not available, leave as null
      });
  }, []);

  const isActive = stats !== null;

  return (
    <div className="p-4 space-y-3">
      {/* Status card */}
      <div className="rounded-[10px] border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-[10px] flex items-center justify-center ${
              isActive ? "bg-safe-bg" : "bg-surface"
            }`}
          >
            {isActive ? (
              <ShieldCheck size={20} className="text-safe" />
            ) : (
              <ShieldOff size={20} className="text-text-muted" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-text-primary">
              Facebook Protection
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isActive ? "bg-safe" : "bg-text-muted"
                }`}
              />
              <span className="text-[11px] font-medium text-text-secondary">
                {isActive ? "Active" : "Not enabled"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      {isActive ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[10px] border border-border bg-background p-3 text-center">
            <p className="text-[22px] font-bold text-text-primary">
              {stats.checked.toLocaleString()}
            </p>
            <p className="text-[11px] font-medium text-text-secondary mt-0.5">
              Ads checked
            </p>
          </div>
          <div className="rounded-[10px] border border-border bg-background p-3 text-center">
            <p className="text-[22px] font-bold text-danger">
              {stats.blocked.toLocaleString()}
            </p>
            <p className="text-[11px] font-medium text-text-secondary mt-0.5">
              Scams blocked
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-[10px] bg-surface border border-border p-4 text-center">
          <Eye size={24} className="mx-auto text-text-muted mb-2" />
          <p className="text-[13px] text-text-secondary leading-relaxed">
            Browse Facebook to start detecting scam ads automatically.
          </p>
        </div>
      )}

      {/* Marketplace protection hint */}
      <div className="rounded-[10px] border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-primary-light flex items-center justify-center">
            <Shield size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-text-primary">
              Marketplace Protection
            </p>
            <p className="text-[11px] text-text-secondary mt-0.5">
              Auto-scans listings and chats
            </p>
          </div>
          <span className="w-2 h-2 rounded-full bg-safe" />
        </div>
      </div>

      {/* Learn more */}
      <a
        href="https://askarthur.au/extension"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary-hover transition-colors duration-150 py-2"
      >
        Learn how it works
        <ExternalLink size={12} />
      </a>
    </div>
  );
}
