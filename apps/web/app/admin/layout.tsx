import { cookies } from "next/headers";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { verifyAdminToken, COOKIE_NAME } from "@/lib/adminAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import AdminShell from "@/components/admin/AdminShell";

// Admin chrome fonts. Scoped to /admin/* so they don't add weight to
// marketing / consumer pages. `next/font/google` self-hosts at build time
// and exposes CSS variables that `globals.css` reads (var(--font-geist),
// var(--font-geist-mono-var), var(--font-source-serif)).
const geistSans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-geist-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-geist-mono-var",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-source-serif",
});

// Cheap auth probe for the chrome. Mirrors requireAdmin() ordering (SSO
// first, HMAC fallback) but never redirects. Unauthed callers get bare
// children — each page still calls requireAdmin() for real protection.
// Keeping this in the layout means /admin/login renders without the
// admin shell wrapping the login form.
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

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthed();
  if (!authed) return <>{children}</>;

  return (
    <div
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable}`}
    >
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
