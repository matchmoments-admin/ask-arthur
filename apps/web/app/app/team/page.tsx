import { requireAuth } from "@/lib/auth";
import { getOrg, getOrgMembers, getOrgInvitations } from "@/lib/org";
import { redirect } from "next/navigation";
import TeamManagement from "./TeamManagement";

export const metadata = {
  title: "Team Management — Ask Arthur",
};

export default async function TeamPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);

  if (!org) {
    redirect("/onboarding");
  }

  const [members, invitations] = await Promise.all([
    getOrgMembers(org.orgId),
    getOrgInvitations(org.orgId),
  ]);

  const canManage = ["owner", "admin"].includes(org.memberRole);

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-deep-navy">Team</h1>
        <p className="text-gov-slate text-sm mt-1">
          Manage your organisation&apos;s team members and invitations.
        </p>
      </div>

      <TeamManagement
        members={members}
        invitations={invitations}
        canManage={canManage}
        currentUserId={user.id}
        orgName={org.orgName}
      />
    </div>
  );
}
