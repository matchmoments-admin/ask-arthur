import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const OrgSectorSchema = z.enum([
  "banking",
  "telco",
  "digital_platform",
  "insurance",
  "superannuation",
  "other",
]);
export type OrgSector = z.infer<typeof OrgSectorSchema>;

export const OrgTierSchema = z.enum(["trial", "pro", "enterprise", "custom"]);
export type OrgTier = z.infer<typeof OrgTierSchema>;

export const OrgStatusSchema = z.enum(["active", "suspended", "churned"]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const OrgRoleSchema = z.enum([
  "owner",
  "admin",
  "compliance_officer",
  "fraud_analyst",
  "developer",
  "viewer",
]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrgMemberStatusSchema = z.enum([
  "pending",
  "active",
  "deactivated",
]);
export type OrgMemberStatus = z.infer<typeof OrgMemberStatusSchema>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase alphanumeric with hyphens"),
  abn: z.string().regex(/^\d{11}$/, "ABN must be 11 digits").nullable(),
  abn_verified: z.boolean(),
  abn_entity_name: z.string().nullable(),
  domain: z.string().nullable(),
  domain_verified: z.boolean(),
  sector: OrgSectorSchema.nullable(),
  tier: OrgTierSchema,
  status: OrgStatusSchema,
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const OrgMemberSchema = z.object({
  id: z.number(),
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: OrgRoleSchema,
  invited_by: z.string().uuid().nullable(),
  accepted_at: z.string().nullable(),
  status: OrgMemberStatusSchema,
  created_at: z.string(),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const OrgInvitationSchema = z.object({
  id: z.number(),
  org_id: z.string().uuid(),
  email: z.string().email(),
  role: OrgRoleSchema,
  token: z.string(),
  invited_by: z.string().uuid(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  created_at: z.string(),
});
export type OrgInvitation = z.infer<typeof OrgInvitationSchema>;

// ---------------------------------------------------------------------------
// Lead schema (for corporate sales pipeline)
// ---------------------------------------------------------------------------

export const LeadSourceSchema = z.enum([
  "website",
  "spf_assessment",
  "calculator",
  "referral",
  "banking_page",
  "telco_page",
  "digital_platforms_page",
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "demo_scheduled",
  "trial",
  "won",
  "lost",
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  email: z.string().email(),
  company_name: z.string().min(1),
  abn: z.string().regex(/^\d{11}$/).nullable(),
  sector: OrgSectorSchema.nullable(),
  role_title: z.string().nullable(),
  phone: z.string().nullable(),
  source: LeadSourceSchema,
  score: z.number().min(0).max(100),
  status: LeadStatusSchema,
  notes: z.array(z.unknown()),
  nurture_step: z.number().min(0).max(6),
  nurture_last_sent_at: z.string().nullable(),
  utm_source: z.string().nullable(),
  utm_medium: z.string().nullable(),
  utm_campaign: z.string().nullable(),
  assessment_data: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

// ---------------------------------------------------------------------------
// Input validation schemas (for API routes)
// ---------------------------------------------------------------------------

export const CreateLeadInputSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  email: z.string().email().max(320).trim().toLowerCase(),
  company_name: z.string().min(1).max(200).trim(),
  abn: z.string().regex(/^\d{11}$/, "ABN must be 11 digits").optional(),
  sector: OrgSectorSchema.optional(),
  role_title: z.string().max(200).trim().optional(),
  phone: z.string().max(20).trim().optional(),
  source: LeadSourceSchema.optional(),
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
  assessment_data: z.record(z.string(), z.unknown()).optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const CreateOrgInputSchema = z.object({
  name: z.string().min(2).max(200).trim(),
  abn: z.string().regex(/^\d{11}$/, "ABN must be 11 digits").optional(),
  sector: OrgSectorSchema.optional(),
});
export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;

export const InviteMemberInputSchema = z.object({
  email: z.string().email().max(320).trim().toLowerCase(),
  role: OrgRoleSchema.exclude(["owner"]), // Cannot invite as owner
});
export type InviteMemberInput = z.infer<typeof InviteMemberInputSchema>;

// ---------------------------------------------------------------------------
// Role permissions — defines what each org role can do
// ---------------------------------------------------------------------------

export type OrgPermission =
  | "org:read"
  | "org:update"
  | "org:delete"
  | "members:read"
  | "members:invite"
  | "members:update_role"
  | "members:remove"
  | "keys:read"
  | "keys:create"
  | "keys:revoke"
  | "dashboard:overview"
  | "dashboard:compliance"
  | "dashboard:compliance:export"
  | "dashboard:investigations"
  | "dashboard:developer"
  | "dashboard:executive"
  | "billing:read"
  | "billing:manage"
  | "team:read"
  | "team:manage";

export const ORG_ROLE_PERMISSIONS: Record<OrgRole, OrgPermission[]> = {
  owner: [
    "org:read", "org:update", "org:delete",
    "members:read", "members:invite", "members:update_role", "members:remove",
    "keys:read", "keys:create", "keys:revoke",
    "dashboard:overview", "dashboard:compliance", "dashboard:compliance:export",
    "dashboard:investigations", "dashboard:developer", "dashboard:executive",
    "billing:read", "billing:manage",
    "team:read", "team:manage",
  ],
  admin: [
    "org:read", "org:update",
    "members:read", "members:invite", "members:update_role", "members:remove",
    "keys:read", "keys:create", "keys:revoke",
    "dashboard:overview", "dashboard:compliance", "dashboard:compliance:export",
    "dashboard:investigations", "dashboard:developer", "dashboard:executive",
    "billing:read", "billing:manage",
    "team:read", "team:manage",
  ],
  compliance_officer: [
    "org:read",
    "members:read",
    "keys:read",
    "dashboard:overview", "dashboard:compliance", "dashboard:compliance:export",
    "dashboard:executive",
    "billing:read",
    "team:read",
  ],
  fraud_analyst: [
    "org:read",
    "members:read",
    "keys:read",
    "dashboard:overview", "dashboard:compliance",
    "dashboard:investigations",
    "team:read",
  ],
  developer: [
    "org:read",
    "members:read",
    "keys:read", "keys:create",
    "dashboard:overview", "dashboard:developer",
    "team:read",
  ],
  viewer: [
    "org:read",
    "members:read",
    "dashboard:overview", "dashboard:compliance",
    "team:read",
  ],
} as const;

/** Check if a role has a specific permission */
export function hasPermission(role: OrgRole, permission: OrgPermission): boolean {
  return ORG_ROLE_PERMISSIONS[role].includes(permission);
}
