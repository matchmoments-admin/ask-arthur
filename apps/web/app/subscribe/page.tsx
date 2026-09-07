// Standalone newsletter-signup landing (#933 item 4). Exists primarily as a
// link target for surfaces that can't render a form — the scan@ verdict-reply
// email footer links here — and as a shareable subscribe URL.

import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SubscribeForm from "@/components/SubscribeForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Arthur’s Watch — Free Weekly Scam Alerts",
  description:
    "The scams circulating in Australia this week — fake texts, lookalike stores, charity impersonations — delivered in one free weekly email. Free, unsubscribe any time.",
};

export default function SubscribePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Arthur’s Watch
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          One free weekly email to help you spot suspicious texts, lookalike
          stores and impersonation scams. Practical checks you can share with
          family and friends. Confirm your email to join; unsubscribe any time.
        </p>
        <div className="max-w-md mx-auto">
          <SubscribeForm variant="inline" source="subscribe_page" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
