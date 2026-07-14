import { IBM_Plex_Mono } from "next/font/google";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

// IBM Plex Mono is loaded here (not the root layout) so its preload is scoped
// to the clone-watch routes — it's used ONLY for domain strings + the contact
// email on these pages, per the hybrid-typography decision (Public Sans stays
// the site font everywhere else). Exposed as --font-plex-mono on the wrapper.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export default function CloneWatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`min-h-screen flex flex-col ${plexMono.variable}`}>
      {/* Standard shared Nav + 640px content column — identical to every other
          marketing page (the whole surface is single-column, so it needs no
          extra width). */}
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
