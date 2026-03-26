import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import DashboardNav from "@/components/DashboardNav";

export const metadata = {
  title: "Dashboard — Ask Arthur",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#EFF4F8]">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-6xl mx-auto px-5 py-6">
        <DashboardNav />
        {children}
      </main>
      <Footer />
    </div>
  );
}
