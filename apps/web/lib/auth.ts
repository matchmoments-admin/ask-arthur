import "server-only";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";

export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
  displayName: string | null;
  orgId: string | null;
  orgRole: string | null;
  orgName: string | null;
}

/**
 * Get the current authenticated user, or null if not logged in.
 * Uses supabase.auth.getUser() (server-side JWT validation, not spoofable).
 */
export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createAuthServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    role:
      (user.app_metadata?.role as "user" | "admin") === "admin"
        ? "admin"
        : "user",
    displayName: (user.user_metadata?.display_name as string) ?? null,
    orgId: null,
    orgRole: null,
    orgName: null,
  };
}

/**
 * Require authentication. Redirects to /login if not logged in.
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Require admin role. Redirects to /login if not logged in, /app if not admin.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect("/app");
  }
  return user;
}
