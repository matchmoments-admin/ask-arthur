import "server-only";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { logger } from "@askarthur/utils/logger";

export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
  displayName: string | null;
  orgId: string | null;
  orgRole: string | null;
  orgName: string | null;
}

// Thrown by getUser() when Supabase Auth fails to respond within the budget.
// Distinct from "not logged in" so API routes can return 503 + Retry-After
// instead of 401, and dashboards can distinguish "logged out" from
// "auth degraded." Layouts via requireAuth() catch this and redirect to
// /login (same UX as session expiry). Incident 2026-05-09.
export class AuthUnavailableError extends Error {
  constructor(message = "Supabase Auth is unavailable") {
    super(message);
    this.name = "AuthUnavailableError";
  }
}

const AUTH_TIMEOUT_MS = 5000;

/**
 * Get the current authenticated user, or null if not logged in.
 * Uses supabase.auth.getUser() (server-side JWT validation, not spoofable).
 *
 * Throws AuthUnavailableError if Supabase Auth doesn't respond within
 * AUTH_TIMEOUT_MS. Callers that want fail-open behaviour should catch.
 */
export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createAuthServerClient();
  if (!supabase) return null;

  const result = await Promise.race([
    supabase.auth.getUser(),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), AUTH_TIMEOUT_MS),
    ),
  ]);

  if (result === "timeout") {
    logger.error(
      `lib/auth.getUser: supabase.auth.getUser timed out after ${AUTH_TIMEOUT_MS}ms`,
    );
    throw new AuthUnavailableError();
  }

  const user = result.data.user;
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
 * Require authentication. Redirects to /login if not logged in OR if
 * Supabase Auth is unavailable (incident-resilient: same UX as session expiry).
 */
export async function requireAuth(): Promise<AuthUser> {
  let user: AuthUser | null;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      redirect("/login?reason=auth_unavailable");
    }
    throw err;
  }
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Require admin role. Redirects to /login if not logged in / auth unavailable,
 * /app if not admin.
 */
export async function requireAdmin(): Promise<AuthUser> {
  let user: AuthUser | null;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      redirect("/login?reason=auth_unavailable");
    }
    throw err;
  }
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect("/app");
  }
  return user;
}
