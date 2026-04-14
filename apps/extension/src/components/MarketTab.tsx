import { ShieldAlert, UserCheck, ExternalLink } from "lucide-react";

export function MarketTab() {
  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert size={18} className="text-primary" />
        <h2 className="text-[15px] font-semibold text-text-primary">Marketplace Safety</h2>
      </div>

      {/* PayID Safety Tips */}
      <div className="rounded-[10px] border border-border bg-background p-3 space-y-2.5">
        <h3 className="text-[13px] font-semibold text-text-primary">PayID Safety Tips</h3>
        <ul className="space-y-2">
          {[
            "PayID never sends emails or SMS confirmations",
            "Beware of 'relative will collect' messages",
            "Never send money to 'upgrade' your account",
            "Verify payments in your banking app only",
          ].map((tip, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" />
              <span className="text-[13px] text-text-secondary leading-relaxed">{tip}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* How to Check a Seller */}
      <div className="rounded-[10px] border border-border bg-background p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-primary" />
          <h3 className="text-[13px] font-semibold text-text-primary">How to Check a Seller</h3>
        </div>
        <ol className="space-y-2 list-decimal list-inside">
          {[
            "Open the seller's profile on Facebook Marketplace",
            "Ask Arthur will automatically scan the listing",
            "Check the verdict badge before making contact",
            "Use the Check tab to verify any links they send",
          ].map((step, i) => (
            <li key={i} className="text-[13px] text-text-secondary leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* More info link */}
      <a
        href="https://askarthur.au/guides/marketplace-safety"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary-hover transition-colors duration-150 py-2"
      >
        More safety guides
        <ExternalLink size={12} />
      </a>
    </div>
  );
}
