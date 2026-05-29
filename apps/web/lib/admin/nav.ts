// Navigation structure for the admin dashboard. Source of truth for
// section grouping, page titles, and lucide icon assignment used by
// AdminShell + SideTray + TopBar.
//
// The `usePathname()` lookup in AdminShell maps the current route back to
// an entry here, which is how the TopBar derives its page title without
// any per-page wiring.

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShieldCheck,
  MessageSquare,
  Inbox,
  Bell,
  Coins,
  Activity,
  Lock,
  Phone,
  Send,
  FileText,
  Mail,
} from "lucide-react";

export interface AdminNavItem {
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
}

export interface AdminNavSection {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    label: "Operations",
    items: [
      { id: "overview", name: "Overview", href: "/admin", icon: LayoutDashboard },
      { id: "clone-watch", name: "Clone-watch triage", href: "/admin/clone-watch", icon: ShieldCheck },
      { id: "feedback", name: "Feedback triage", href: "/admin/feedback", icon: MessageSquare },
      { id: "inbound", name: "Inbound queue", href: "/admin/inbound-quarantine", icon: Inbox },
      { id: "alerts", name: "Brand alerts", href: "/admin/brand-alerts", icon: Bell },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { id: "costs", name: "Costs", href: "/admin/costs", icon: Coins },
      { id: "health", name: "System health", href: "/admin/health", icon: Activity },
      { id: "vuln", name: "Vulnerabilities", href: "/admin/vulnerabilities", icon: Lock },
      { id: "phone", name: "Phone footprint", href: "/admin/phone-footprint", icon: Phone },
      { id: "onward", name: "Onward reports", href: "/admin/onward-reports", icon: Send },
      { id: "email-studio", name: "Email Studio", href: "/admin/email-studio", icon: Mail },
      { id: "blog", name: "Blog", href: "/admin/blog", icon: FileText },
    ],
  },
];

/** Look up the nav item matching a pathname (longest-prefix wins). */
export function findActiveNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      const isMatch = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
      if (isMatch && (best === null || item.href.length > best.href.length)) {
        best = item;
      }
    }
  }
  return best;
}
