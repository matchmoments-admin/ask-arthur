import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PersonaChecker from "@/components/PersonaChecker";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Persona Checker — Is This Person Real? | Ask Arthur",
  description:
    "Check if someone you met online is who they claim to be. Detect romance scams, fake recruiters, and identity fraud with AI analysis.",
};

export default function PersonaCheckPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Is This Person Real?
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Paste a profile, message, or describe the situation.
          Arthur will check for romance scams, fake recruiters, and identity fraud.
        </p>
        <PersonaChecker />
      </main>
      <Footer />
    </div>
  );
}
