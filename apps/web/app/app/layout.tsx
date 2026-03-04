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
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 py-8"
      >
        <DashboardNav />
        {children}
      </main>
      <Footer />
    </div>
  );
}
