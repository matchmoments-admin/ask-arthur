import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Set Up Your Organization — Ask Arthur",
};

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full max-w-[640px] mx-auto px-5 py-4">
        <Link
          href="/"
          className="text-deep-navy font-extrabold text-lg uppercase tracking-wide"
        >
          Ask Arthur
        </Link>
      </div>
      <main className="w-full max-w-[640px] mx-auto px-5 py-8">
        {children}
      </main>
    </div>
  );
}
