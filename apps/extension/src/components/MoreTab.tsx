import { useEffect, useState } from "react";
import { Shield, User, Info, HelpCircle, ExternalLink, ChevronRight, Link2 } from "lucide-react";
import type { MessageResponse } from "@/lib/types";
import { checkSubscription } from "@/lib/subscription";
import { openUpgradePage } from "@/lib/upgrade";

declare const __EXTENSION_BILLING_ENABLED__: boolean;

const API_ORIGIN = "https://askarthur.au";

/** Real tier from /api/extension/subscription (1h client cache in
 *  lib/subscription.ts) — replaces the hardcoded "Free" this row shipped
 *  with. Renders "Free" until resolved; never blocks the tab. */
function useTier(): "free" | "pro" {
  const [tier, setTier] = useState<"free" | "pro">("free");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await chrome.runtime.sendMessage({
          type: "GET_STATUS",
        })) as MessageResponse<{ installId: string | null }>;
        const installId = res.success ? res.data?.installId : null;
        if (!installId) return;
        const sub = await checkSubscription(installId, API_ORIGIN);
        if (!cancelled) setTier(sub.tier);
      } catch {
        // Stay on "free" — cosmetic only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return tier;
}

function LinkAccountRow() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLink() {
    setBusy(true);
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "MINT_LINK_TOKEN",
      })) as MessageResponse<{ token: string }>;
      if (res.success && res.data?.token) {
        await chrome.tabs.create({
          url: `https://askarthur.au/extension/link?token=${encodeURIComponent(res.data.token)}`,
        });
      } else {
        setError(res.error ?? "Couldn't start linking — try again.");
      }
    } catch {
      setError("Couldn't start linking — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onLink}
      disabled={busy}
      className="flex w-full items-center justify-between px-3 py-2 min-h-[44px] hover:bg-surface transition-colors duration-150 disabled:opacity-60"
    >
      <span className="flex items-center gap-2 text-[13px] text-text-primary">
        <Link2 size={14} className="text-text-muted" />
        {busy ? "Opening…" : "Link account"}
      </span>
      {error ? (
        <span className="text-[11px] text-risk">{error}</span>
      ) : (
        <ChevronRight size={16} className="text-text-muted" />
      )}
    </button>
  );
}

export function MoreTab() {
  const tier = useTier();
  return (
    <div className="p-4 space-y-4">
      {/* Protection section */}
      <Section icon={Shield} title="Protection">
        <SettingRow
          label="Facebook ad detection"
          description="Automatically scans ads in your feed"
          trailing={
            <span className="text-[11px] font-medium text-safe bg-safe-bg px-2 py-0.5 rounded-full">
              On
            </span>
          }
        />
        <SettingRow
          label="Marketplace scanning"
          description="Checks listings and chat messages"
          trailing={
            <span className="text-[11px] font-medium text-safe bg-safe-bg px-2 py-0.5 rounded-full">
              On
            </span>
          }
        />
      </Section>

      {/* Account section */}
      <Section icon={User} title="Account">
        <SettingRow
          label="Plan"
          trailing={
            <span
              className={`text-[11px] font-medium ${tier === "pro" ? "text-safe bg-safe-bg px-2 py-0.5 rounded-full" : "text-text-secondary"}`}
            >
              {tier === "pro" ? "Pro" : "Free"}
            </span>
          }
        />
        {__EXTENSION_BILLING_ENABLED__ && <LinkAccountRow />}
        {tier !== "pro" && (
          <button
            type="button"
            onClick={() => openUpgradePage("extension_more")}
            className="flex w-full items-center justify-between px-3 py-2 min-h-[44px] hover:bg-surface transition-colors duration-150"
          >
            <span className="text-[13px] text-primary font-medium">Upgrade to Pro</span>
            <ChevronRight size={16} className="text-text-muted" />
          </button>
        )}
      </Section>

      {/* About section */}
      <Section icon={Info} title="About">
        <SettingRow
          label="Version"
          trailing={
            <span className="text-[11px] text-text-muted">
              {chrome.runtime.getManifest?.()?.version ?? "1.0.0"}
            </span>
          }
        />
        <LinkRow label="Website" href="https://askarthur.au" />
        <LinkRow label="Privacy Policy" href="https://askarthur.au/privacy" />
        <LinkRow label="Terms of Service" href="https://askarthur.au/terms" />
      </Section>

      {/* Support section */}
      <Section icon={HelpCircle} title="Support">
        <LinkRow label="Report a bug" href="https://askarthur.au/contact?type=bug" />
        <LinkRow label="Contact us" href="https://askarthur.au/contact" />
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Shield;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-text-muted" />
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="rounded-[10px] border border-border bg-background divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  trailing,
}: {
  label: string;
  description?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 min-h-[44px]">
      <div>
        <p className="text-[13px] text-text-primary">{label}</p>
        {description && (
          <p className="text-[11px] text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {trailing}
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between px-3 py-2 min-h-[44px] hover:bg-surface transition-colors duration-150"
    >
      <span className="text-[13px] text-text-primary">{label}</span>
      <ExternalLink size={14} className="text-text-muted" />
    </a>
  );
}
