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
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function getVisibleNavGroups(orgRole: string | null): NavGroup[] {
  if (!orgRole) {
    return [
      {
        label: "Workspace",
        items: [
          { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
          { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
          { label: "Reports", href: "/app/reports", icon: FileText },
          { label: "Compliance", href: "/app/spf-compliance", icon: ShieldCheck },
        ],
      },
      {
        label: "Account",
        items: [
          { label: "API Keys", href: "/app/keys", icon: Key },
          { label: "Billing", href: "/app/billing", icon: CreditCard },
          { label: "Settings", href: "/app/settings", icon: Settings },
        ],
      },
    ];
  }

  const workspace: NavItem[] = [
    { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
    { label: "Compliance", href: "/app/compliance", icon: ShieldCheck },
    { label: "Fraud Manager", href: "/app/fraud-manager", icon: Search, roles: ["owner", "admin", "fraud_analyst", "compliance_officer"] },
    { label: "Investigations", href: "/app/investigations", icon: ShieldAlert, roles: ["owner", "admin", "fraud_analyst"] },
    { label: "Executive", href: "/app/executive", icon: BarChart3, roles: ["owner", "admin", "compliance_officer"] },
    { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
    { label: "Reports", href: "/app/reports", icon: FileText },
  ].filter((item) => !item.roles || item.roles.includes(orgRole));

  const account: NavItem[] = [
    { label: "Team", href: "/app/team", icon: Users, roles: ["owner", "admin"] },
    { label: "Developer", href: "/app/developer", icon: Code, roles: ["owner", "admin", "developer"] },
    { label: "API Keys", href: "/app/keys", icon: Key },
    { label: "Billing", href: "/app/billing", icon: CreditCard, roles: ["owner", "admin"] },
    { label: "Settings", href: "/app/settings", icon: Settings },
  ].filter((item) => !item.roles || item.roles.includes(orgRole));

  return [
    { label: "Workspace", items: workspace },
    { label: "Account", items: account },
  ];
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  compliance_officer: "Compliance",
  fraud_analyst: "Analyst",
  developer: "Developer",
  viewer: "Viewer",
};

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid place-items-center text-white shrink-0"
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: "var(--color-deep-navy)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 4 5v6.5C4 16 7.5 19.7 12 22c4.5-2.3 8-6 8-10.5V5l-8-3z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  );
}

function NavGroups({
  pathname,
  orgRole,
  onNavigate,
}: {
  pathname: string;
  orgRole: string | null;
  onNavigate?: () => void;
}) {
  const groups = getVisibleNavGroups(orgRole);

  return (
    <nav className="flex-1 px-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-px">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-[10px] pt-1 pb-1.5"
          >
            {group.label}
          </div>
          {group.items.map(({ label, href, icon: Icon, exact, badge }) => {
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className="flex items-center gap-2.5 transition-colors"
                style={{
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "var(--color-deep-navy)" : "#475569",
                  background: isActive ? "#f1f5f9" : "transparent",
                }}
              >
                <Icon size={15} strokeWidth={1.7} />
                <span className="flex-1">{label}</span>
                {badge ? (
                  <span
                    className="grid place-items-center"
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 9,
                      background: "#fee2e2",
                      color: "#991b1b",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

interface DashboardSidebarProps {
  userEmail: string;
  userRole: string;
  orgName?: string | null;
  orgRole?: string | null;
}

export default function DashboardSidebar(props: DashboardSidebarProps) {
  const pathname = usePathname();
  return <DashboardSidebarInner key={pathname} {...props} />;
}

function userInitials(email: string) {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[^a-zA-Z]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (cleaned.slice(0, 2) || "U").toUpperCase();
}

function SidebarFooter({
  orgName,
  orgRole,
  userEmail,
  userRole,
}: {
  orgName: string | null | undefined;
  orgRole: string | null | undefined;
  userEmail: string;
  userRole: string;
}) {
  const roleLabel = orgRole
    ? ROLE_LABELS[orgRole] ?? orgRole
    : userRole === "admin"
      ? "Admin"
      : "Member";
  const initials = userInitials(userEmail);

  return (
    <div className="px-3 pt-3 pb-3 flex flex-col gap-3">
      {orgName ? (
        <div
          className="bg-white"
          style={{
            border: "1px solid #eef0f3",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1"
          >
            Organisation
          </div>
          <div
            className="text-deep-navy text-[13px] font-medium truncate"
            title={orgName}
          >
            {orgName}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{roleLabel}</div>
        </div>
      ) : null}

      <div
        className="flex items-center gap-2.5 pt-3"
        style={{ borderTop: "1px solid #eef0f3" }}
      >
        <span
          className="grid place-items-center text-slate-600 font-semibold shrink-0"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "#e2e8f0",
            fontSize: 11,
          }}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-deep-navy font-medium truncate">
            {userEmail}
          </div>
          <div className="text-[11px] text-slate-500 truncate">{roleLabel}</div>
        </div>
      </div>
    </div>
  );
}

function DashboardSidebarInner({
  userEmail,
  userRole,
  orgName,
  orgRole,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
      <aside
        className="hidden lg:flex flex-col min-h-screen shrink-0"
        style={{
          width: 236,
          background: "#fbfbfa",
          borderRight: "1px solid #eef0f3",
        }}
      >
        <div className="px-3 pt-5 pb-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 px-[10px]"
          >
            <BrandMark />
            <span className="flex flex-col leading-tight min-w-0">
              <span className="text-[14px] font-semibold tracking-tight text-deep-navy">
                askArthur
              </span>
              <span className="text-[11px] text-slate-500 truncate">
                {orgName ? `${orgName} · AU` : "Intelligence · AU"}
              </span>
            </span>
          </Link>
        </div>

        <NavGroups pathname={pathname} orgRole={orgRole ?? null} />

        <SidebarFooter
          orgName={orgName}
          orgRole={orgRole}
          userEmail={userEmail}
          userRole={userRole}
        />
      </aside>

      {/* Mobile header bar */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between"
        style={{
          background: "#fff",
          borderBottom: "1px solid #eef0f3",
          padding: "10px 16px",
        }}
      >
        <Link href="/" className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[14px] font-semibold tracking-tight text-deep-navy">
            askArthur
          </span>
        </Link>
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
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-72 transform transition-transform duration-200 ease-out flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#fbfbfa", borderRight: "1px solid #eef0f3" }}
      >
        <div
          className="px-3 pt-5 pb-4 flex items-center justify-between"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 px-[10px]"
            onClick={() => setMobileOpen(false)}
          >
            <BrandMark />
            <span className="flex flex-col leading-tight">
              <span className="text-[14px] font-semibold tracking-tight text-deep-navy">
                askArthur
              </span>
              <span className="text-[11px] text-slate-500">
                {orgName ? `${orgName} · AU` : "Intelligence · AU"}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            className="p-2 text-slate-500 hover:text-deep-navy"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <NavGroups
          pathname={pathname}
          orgRole={orgRole ?? null}
          onNavigate={() => setMobileOpen(false)}
        />

        <SidebarFooter
          orgName={orgName}
          orgRole={orgRole}
          userEmail={userEmail}
          userRole={userRole}
        />
      </div>
    </>
  );
}
