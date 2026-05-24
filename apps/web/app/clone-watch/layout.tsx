import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

export default function CloneWatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 w-full max-w-[800px] mx-auto px-5 pt-16 pb-16">
        {children}
      </main>
      <Footer />
    </div>
  );
}
