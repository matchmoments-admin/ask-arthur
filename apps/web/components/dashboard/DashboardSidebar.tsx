"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  FileText,
  Key,
  CreditCard,
  Settings,
  Menu,
  X,
  Users,
  Code,
  BarChart3,
  Search,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  roles?: string[];
}

const baseNavItems: NavItem[] = [
  { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
  { label: "Compliance", href: "/app/compliance", icon: ShieldCheck },
  { label: "Fraud Manager", href: "/app/fraud-manager", icon: Search, roles: ["owner", "admin", "fraud_analyst", "compliance_officer"] },
  { label: "Investigations", href: "/app/investigations", icon: ShieldAlert, roles: ["owner", "admin", "fraud_analyst"] },
  { label: "Developer", href: "/app/developer", icon: Code, roles: ["owner", "admin", "developer"] },
  { label: "Executive", href: "/app/executive", icon: BarChart3, roles: ["owner", "admin", "compliance_officer"] },
  { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
  { label: "Reports", href: "/app/reports", icon: FileText },
  { label: "Team", href: "/app/team", icon: Users, roles: ["owner", "admin"] },
  { label: "API Keys", href: "/app/keys", icon: Key },
  { label: "Billing", href: "/app/billing", icon: CreditCard, roles: ["owner", "admin"] },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

function getVisibleNavItems(orgRole: string | null): NavItem[] {
  if (!orgRole) {
    // No org — show consumer nav (backwards compatible)
    return [
      { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
      { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
      { label: "Reports", href: "/app/reports", icon: FileText },
      { label: "Compliance", href: "/app/spf-compliance", icon: ShieldCheck },
      { label: "API Keys", href: "/app/keys", icon: Key },
      { label: "Billing", href: "/app/billing", icon: CreditCard },
      { label: "Settings", href: "/app/settings", icon: Settings },
    ];
  }

  return baseNavItems.filter(
    (item) => !item.roles || item.roles.includes(orgRole)
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  compliance_officer: "Compliance",
  fraud_analyst: "Analyst",
  developer: "Developer",
  viewer: "Viewer",
};

function NavContent({
  pathname,
  orgRole,
  onNavigate,
}: {
  pathname: string;
  orgRole: string | null;
  onNavigate?: () => void;
}) {
  const items = getVisibleNavItems(orgRole);

  return (
    <nav className="flex-1 py-3 px-3">
      {items.map(({ label, href, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm transition-all ${
              isActive
                ? "bg-deep-navy text-white font-medium shadow-sm"
                : "text-gov-slate hover:text-deep-navy hover:bg-slate-50"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardSidebar({
  userEmail,
  userRole,
  orgName,
  orgRole,
}: {
  userEmail: string;
  userRole: string;
  orgName?: string | null;
  orgRole?: string | null;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 min-h-screen bg-white border-r border-border-light shrink-0">
        <div className="px-5 py-4 border-b border-border-light">
          <Link href="/" className="font-extrabold text-sm uppercase tracking-wide text-deep-navy">
            Ask Arthur
          </Link>
          {orgName ? (
            <span className="block text-[10px] text-trust-teal mt-0.5 uppercase tracking-widest font-semibold truncate">
              {orgName}
            </span>
          ) : (
            <span className="block text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest">
              Intelligence
            </span>
          )}
        </div>

        <NavContent pathname={pathname} orgRole={orgRole ?? null} />

        <div className="px-5 py-3 border-t border-border-light">
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
          <p className="text-[10px] text-slate-300 uppercase tracking-wider mt-0.5">
            {orgRole
              ? ROLE_LABELS[orgRole] ?? orgRole
              : userRole === "admin"
                ? "Admin"
                : "Partner"}
          </p>
        </div>
      </aside>

      {/* Mobile header bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-border-light px-4 py-3 flex items-center justify-between">
        <div>
          <Link href="/" className="font-extrabold text-sm uppercase tracking-wide text-deep-navy">
            Ask Arthur
          </Link>
          {orgName && (
            <span className="block text-[9px] text-trust-teal uppercase tracking-widest font-semibold truncate max-w-[180px]">
              {orgName}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="p-2 -mr-2 text-deep-navy"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile slide-out drawer */}
      <div
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-white border-r border-border-light transform transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between">
          <div>
            <span className="font-extrabold text-sm uppercase tracking-wide text-deep-navy">
              Ask Arthur
            </span>
            {orgName ? (
              <span className="block text-[10px] text-trust-teal mt-0.5 uppercase tracking-widest font-semibold truncate">
                {orgName}
              </span>
            ) : (
              <span className="block text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest">
                Intelligence
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="p-2 -mr-2 text-slate-400 hover:text-deep-navy"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <NavContent pathname={pathname} orgRole={orgRole ?? null} onNavigate={() => setMobileOpen(false)} />

        <div className="px-5 py-3 border-t border-border-light">
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
          {orgRole && (
            <p className="text-[10px] text-slate-300 uppercase tracking-wider mt-0.5">
              {ROLE_LABELS[orgRole] ?? orgRole}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
