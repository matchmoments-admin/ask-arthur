import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { Shield, CheckCircle } from "lucide-react";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "Talk to an Expert — Ask Arthur",
  description:
    "Get Australian scam intelligence delivered to your team. Book a call.",
};

const BENEFITS = [
  "Weekly Australian scam intelligence report tailored to your sector",
  "Real-time alerts when high-risk entities are detected",
  "Phone number, URL, and domain monitoring against 14 threat feeds",
  "SPF Act compliance guidance included",
  "Direct contact — respond to threats within the hour",
];

export default function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <Shield size={28} className="text-action-teal" />
          <h1 className="text-deep-navy text-3xl font-extrabold">
            Talk to an expert
          </h1>
        </div>
        <p className="text-gov-slate text-base leading-relaxed mb-8">
          Our managed service puts Australian scam intelligence directly into
          your workflow. We handle the monitoring, detection, and alerting so
          your team can focus on response.
        </p>

        {/* What you get card */}
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-sm font-semibold text-deep-navy mb-4">
            What you get
          </h2>
          <ul className="space-y-3">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5">
                <CheckCircle
                  size={16}
                  className="text-safe-green mt-0.5 flex-shrink-0"
                />
                <span className="text-sm text-gov-slate leading-snug">
                  {benefit}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 pt-4 border-t border-border-light">
            <p className="text-xs text-slate-500">
              Starting from{" "}
              <span className="text-deep-navy font-semibold">
                A$1,500/month
              </span>
              , no lock-in.
            </p>
          </div>
        </div>

        {/* Contact form */}
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-sm font-semibold text-deep-navy mb-4">
            Book a call
          </h2>
          <ContactForm />
        </div>

        {/* Alternative contact */}
        <p className="text-center text-xs text-slate-500">
          Prefer email? Reach us at{" "}
          <a
            href="mailto:brendan@askarthur.au"
            className="text-action-teal hover:underline font-medium"
          >
            brendan@askarthur.au
          </a>
        </p>
      </main>

      <Footer />
    </div>
  );
}
