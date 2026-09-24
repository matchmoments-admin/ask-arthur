// Org roles that can be granted through an invitation or a member update.
// Never `owner`: ownership is created by create_organization and is not a
// grantable role. One list for the invite, accept and members routes.
export const ASSIGNABLE_ORG_ROLES = [
  "admin",
  "compliance_officer",
  "fraud_analyst",
  "developer",
  "viewer",
] as const;

export type AssignableOrgRole = (typeof ASSIGNABLE_ORG_ROLES)[number];

export function isAssignableOrgRole(role: unknown): role is AssignableOrgRole {
  return (
    typeof role === "string" &&
    (ASSIGNABLE_ORG_ROLES as readonly string[]).includes(role)
  );
}
