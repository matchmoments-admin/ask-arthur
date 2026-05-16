import Link from "next/link";
import { cookies } from "next/headers";
import { verifyAdminToken, COOKIE_NAME } from "@/lib/adminAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const dynamic = "force-dynamic";

// Cheap auth probe for the nav. Mirrors requireAdmin() ordering (SSO first,
// HMAC fallback) but never redirects. Unauthed callers just don't see the
// nav — each page still calls requireAdmin() for real protection. Keeping
// this in the layout means the login page renders bare.
async function isAuthed(): Promise<boolean> {
  if (featureFlags.auth) {
    try {
      const { getUser } = await import("@/lib/auth");
      const user = await getUser();
      if (user?.role === "admin") return true;
    } catch {
      // Fall through to HMAC probe.
    }
  }
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return Boolean(token && verifyAdminToken(token));
}

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/costs", label: "Costs" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/inbound-quarantine", label: "Inbound queue" },
  { href: "/admin/brand-alerts", label: "Brand alerts" },
  { href: "/admin/vulnerabilities", label: "Vulnerabilities" },
  { href: "/admin/phone-footprint", label: "Phone footprint" },
  { href: "/admin/onward-reports", label: "Onward reports" },
  { href: "/admin/blog", label: "Blog" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthed();
  if (!authed) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-5 py-3 text-sm">
          <Link
            href="/admin"
            className="mr-3 shrink-0 text-deep-navy font-semibold tracking-tight"
          >
            Ask Arthur · admin
          </Link>
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-gov-slate transition-colors hover:bg-slate-100 hover:text-deep-navy"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
