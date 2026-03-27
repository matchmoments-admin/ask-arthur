"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  CheckSquare,
  Key,
  CreditCard,
  Settings,
  Menu,
  X,
} from "lucide-react";

const navItems: Array<{ label: string; href: string; icon: typeof LayoutDashboard; exact?: boolean }> = [
  { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
  { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
  { label: "Reports", href: "/app/reports", icon: FileText },
  { label: "Compliance", href: "/app/spf-compliance", icon: CheckSquare },
  { label: "API Keys", href: "/app/keys", icon: Key },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 py-3 px-3">
      {navItems.map(({ label, href, icon: Icon, exact }) => {
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

export default function DashboardSidebar({ userEmail, userRole }: { userEmail: string; userRole: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent scroll when mobile menu open
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
          <span className="block text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest">
            Intelligence
          </span>
        </div>

        <NavContent pathname={pathname} />

        <div className="px-5 py-3 border-t border-border-light">
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
          <p className="text-[10px] text-slate-300 uppercase tracking-wider mt-0.5">
            {userRole === "admin" ? "Admin" : "Partner"}
          </p>
        </div>
      </aside>

      {/* Mobile header bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-border-light px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-extrabold text-sm uppercase tracking-wide text-deep-navy">
          Ask Arthur
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
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-white border-r border-border-light transform transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between">
          <div>
            <span className="font-extrabold text-sm uppercase tracking-wide text-deep-navy">
              Ask Arthur
            </span>
            <span className="block text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest">
              Intelligence
            </span>
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

        <NavContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />

        <div className="px-5 py-3 border-t border-border-light">
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
        </div>
      </div>
    </>
  );
}
