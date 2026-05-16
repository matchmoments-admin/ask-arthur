import "server-only";

import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
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
 * Like getUser() but takes a pre-built auth client. Use this in API
 * routes that already need the client for OTHER calls (e.g. `signOut()`
 * after a delete-account) and just want the timeout-wrapped getUser
 * semantics. Returns the raw Supabase User shape (with created_at,
 * email_confirmed_at, etc.) — preserve fields the AskArthur AuthUser
 * type drops.
 *
 * Throws AuthUnavailableError on timeout — API-route callers should
 * catch and return 503 + Retry-After so a transient Supabase Auth
 * degradation doesn't log users out (401 would). Reference shape for
 * the catch + 503 wrap is `apps/web/app/api/family/route.ts` after
 * PR-AUTH-HARDEN.
 *
 * Uses the same AUTH_TIMEOUT_MS budget as getUser() so middleware,
 * server components, and API routes all see the same degraded-Auth
 * threshold.
 */
export async function getSupabaseUserOrThrow(
  authClient: SupabaseClient,
): Promise<SupabaseUser | null> {
  const result = await Promise.race([
    authClient.auth.getUser(),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), AUTH_TIMEOUT_MS),
    ),
  ]);

  if (result === "timeout") {
    logger.error(
      `lib/auth.getSupabaseUserOrThrow: supabase.auth.getUser timed out after ${AUTH_TIMEOUT_MS}ms`,
    );
    throw new AuthUnavailableError();
  }

  return result.data.user ?? null;
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
