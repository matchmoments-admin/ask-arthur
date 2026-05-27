import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminToken, COOKIE_NAME } from "@/lib/adminAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

/**
 * Server-component wrapper for the admin login form. Redirects to
 * `/admin` if the caller already has a valid auth cookie (HMAC) or
 * Supabase admin session. Otherwise renders the form bare.
 *
 * Why this exists: prior to this, an authed admin visiting /admin/login
 * (e.g. a manually-typed URL, or a back-button) got the form rendered
 * INSIDE the admin shell — confusing UX. The shell was wrapping
 * /admin/login because the parent layout's isAuthed() probe returned
 * true. Catching the case here means the redirect happens server-side
 * before the page content evaluates, so the user never sees the chrome
 * around a login form they don't need.
 */
export default async function AdminLoginPage() {
  // Supabase admin session (if the auth feature flag is on)
  if (featureFlags.auth) {
    try {
      const { getUser } = await import("@/lib/auth");
      const user = await getUser();
      if (user?.role === "admin") redirect("/admin");
    } catch {
      // Auth lookup failed — fall through to HMAC cookie check
    }
  }

  // HMAC cookie fallback (existing flow)
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (token && verifyAdminToken(token)) {
    redirect("/admin");
  }

  return <LoginForm />;
}
