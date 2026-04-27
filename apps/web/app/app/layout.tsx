import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { redirect } from "next/navigation";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

export const metadata = {
  title: "Intelligence Dashboard — Ask Arthur",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const org = await getOrg(user.id);

  if (featureFlags.multiTenancy && !org) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#fbfbfa" }}>
      <DashboardSidebar
        userEmail={user.email}
        userRole={user.role || "user"}
        orgName={org?.orgName ?? null}
        orgRole={org?.memberRole ?? null}
      />
      <main className="flex-1 min-w-0 overflow-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
