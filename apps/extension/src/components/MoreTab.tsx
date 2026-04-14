import { Shield, User, Info, HelpCircle, ExternalLink, ChevronRight } from "lucide-react";

export function MoreTab() {
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
            <span className="text-[11px] font-medium text-text-secondary">Free</span>
          }
        />
        <a
          href="https://askarthur.au/extension/upgrade"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 min-h-[44px]"
        >
          <span className="text-[13px] text-primary font-medium">Upgrade to Pro</span>
          <ChevronRight size={16} className="text-text-muted" />
        </a>
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
