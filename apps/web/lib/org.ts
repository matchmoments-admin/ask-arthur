import "server-only";

import { redirect } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import type { OrgRole, OrgPermission } from "@askarthur/types";
import { hasPermission } from "@askarthur/types";
import { getUser } from "./auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrgContext {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgSector: string | null;
  orgTier: string;
  orgStatus: string;
  memberRole: OrgRole;
}

export interface OrgMemberInfo {
  id: number;
  user_id: string;
  role: OrgRole;
  status: string;
  created_at: string;
  accepted_at: string | null;
  display_name: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Get the user's organization context, or null if they don't belong to one.
 * Uses the get_user_org RPC for a single efficient query.
 */
export async function getOrg(userId: string): Promise<OrgContext | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_user_org", {
    p_user_id: userId,
  });

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    orgId: row.org_id,
    orgName: row.org_name,
    orgSlug: row.org_slug,
    orgSector: row.org_sector,
    orgTier: row.org_tier,
    orgStatus: row.org_status,
    memberRole: row.member_role as OrgRole,
  };
}

/**
 * Require the user to belong to an organization.
 * Redirects to /onboarding if no org found.
 */
export async function requireOrg(): Promise<OrgContext> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  const org = await getOrg(user.id);
  if (!org) {
    redirect("/onboarding");
  }

  return org;
}

/**
 * Require the user to have one of the specified org roles.
 * Redirects to /app if insufficient permissions.
 */
export async function requireOrgRole(
  allowedRoles: OrgRole[]
): Promise<OrgContext> {
  const org = await requireOrg();

  if (!allowedRoles.includes(org.memberRole)) {
    redirect("/app");
  }

  return org;
}

/**
 * Require the user to have a specific org permission.
 * Redirects to /app if insufficient permissions.
 */
export async function requireOrgPermission(
  permission: OrgPermission
): Promise<OrgContext> {
  const org = await requireOrg();

  if (!hasPermission(org.memberRole, permission)) {
    redirect("/app");
  }

  return org;
}

/**
 * Get all members of an organization with their profile data.
 */
export async function getOrgMembers(
  orgId: string
): Promise<OrgMemberInfo[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("org_members")
    .select(`
      id,
      user_id,
      role,
      status,
      created_at,
      accepted_at
    `)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  // Fetch user profiles for display names and emails
  const userIds = data.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, display_name, billing_email")
    .in("id", userIds);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  );

  return data.map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role as OrgRole,
    status: m.status,
    created_at: m.created_at,
    accepted_at: m.accepted_at,
    display_name: profileMap.get(m.user_id)?.display_name ?? null,
    email: profileMap.get(m.user_id)?.billing_email ?? null,
  }));
}

/**
 * Get pending invitations for an organization.
 */
export async function getOrgInvitations(orgId: string) {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("org_invitations")
    .select("id, email, role, expires_at, created_at, accepted_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data;
}

/**
 * Generate a URL-safe slug from an organization name.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
