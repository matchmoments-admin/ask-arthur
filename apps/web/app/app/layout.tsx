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
    <div className="min-h-screen flex bg-[#EFF4F8]">
      <DashboardSidebar userEmail={user.email} userRole={user.role || "user"} />

      {/* Mobile header (shown when sidebar is hidden) */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-deep-navy text-white px-4 py-3 flex items-center justify-between">
        <span className="font-extrabold text-sm uppercase tracking-wider">Ask Arthur</span>
        <span className="text-xs text-white/50">{user.email}</span>
      </div>

      <main className="flex-1 min-w-0 overflow-auto lg:pt-0 pt-14">
        {children}
      </main>
    </div>
  );
}
