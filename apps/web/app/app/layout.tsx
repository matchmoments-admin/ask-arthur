import { requireAuth } from "@/lib/auth";
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

  return (
    <div className="min-h-screen flex bg-white">
      <DashboardSidebar userEmail={user.email} userRole={user.role || "user"} />
      <main className="flex-1 min-w-0 overflow-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
