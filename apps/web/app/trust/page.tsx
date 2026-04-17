import type { Metadata } from "next";
import { Shield, Lock, Server, Eye, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Trust & Security",
  description:
    "Ask Arthur's security posture, compliance certifications, infrastructure overview, and data handling practices.",
  alternates: { canonical: "https://askarthur.au/trust" },
};

const subProcessors = [
  { name: "Supabase, Inc.", country: "USA (Sydney region)", purpose: "Database hosting", cert: "SOC 2 Type II" },
  { name: "Vercel, Inc.", country: "USA (Sydney region)", purpose: "Application hosting", cert: "SOC 2 + ISO 27001" },
  { name: "Cloudflare, Inc.", country: "USA (Oceania)", purpose: "CDN + storage", cert: "SOC 2 + ISO 27001" },
  { name: "Resend, Inc.", country: "USA", purpose: "Email delivery", cert: "SOC 2" },
  { name: "Anthropic, PBC", country: "USA", purpose: "AI analysis", cert: "Enterprise DPA" },
  { name: "Twilio Inc.", country: "USA", purpose: "Phone intelligence", cert: "SOC 2 Type II" },
  { name: "Upstash, Inc.", country: "Singapore", purpose: "Rate limiting", cert: "SOC 2" },
];

const certifications: Array<{
  name: string;
  status: "compliant" | "in-progress" | "planned";
  detail: string;
  icon: typeof Shield;
}> = [
  { name: "Australian Privacy Act 1988", status: "compliant", detail: "13 APPs covered", icon: CheckCircle },
  { name: "ASD Essential Eight ML1", status: "compliant", detail: "Self-assessed", icon: CheckCircle },
  { name: "SOC 2 Type I", status: "in-progress", detail: "Target Q3 2026", icon: Shield },
  { name: "ISO 27001", status: "planned", detail: "Target 2027", icon: Clock },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    compliant: "bg-emerald-50 text-emerald-700 border-emerald-200",
    "in-progress": "bg-amber-50 text-amber-700 border-amber-200",
    planned: "bg-slate-50 text-slate-600 border-slate-200",
  };
  const labels: Record<string, string> = {
    compliant: "Compliant",
    "in-progress": "In Progress",
    planned: "Planned",
  };
  return (
    <span className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-full border ${styles[status] ?? styles.planned}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function TrustPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      {/* Hero */}
      <section className="bg-deep-navy text-white py-16 px-5">
        <div className="max-w-2xl mx-auto text-center">
          <Shield size={44} className="mx-auto mb-4 opacity-70" strokeWidth={1.5} />
          <h1 className="text-4xl font-extrabold mb-3">Trust & Security</h1>
          <p className="text-white/70 text-base max-w-lg mx-auto">
            How Ask Arthur protects your data and earns the trust of individuals,
            businesses, and governments.
          </p>
        </div>
      </section>

      <main id="main-content" className="flex-1">
        <div className="max-w-2xl mx-auto px-5 py-12 space-y-12">

          {/* Certifications */}
          <section>
            <h2 className="text-xl font-extrabold text-deep-navy mb-5">
              Compliance & certifications
            </h2>
            <div className="space-y-3">
              {certifications.map(({ name, status, detail, icon: Icon }) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-4 rounded-xl border border-border-light bg-white"
                >
                  <div className="flex items-center gap-3">
                    <Icon size={20} className="text-action-teal flex-shrink-0" />
                    <div>
                      <div className="font-bold text-deep-navy text-sm">{name}</div>
                      <div className="text-xs text-gov-slate">{detail}</div>
                    </div>
                  </div>
                  <StatusBadge status={status} />
                </div>
              ))}
            </div>
          </section>

          {/* Encryption */}
          <section>
            <h2 className="text-xl font-extrabold text-deep-navy mb-5">
              Encryption & data protection
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { icon: Lock, title: "At rest", body: "AES-256 encryption via Supabase (PostgreSQL in Sydney ap-southeast-2)" },
                { icon: Eye, title: "In transit", body: "TLS 1.3 on all connections via Vercel edge + Cloudflare" },
                { icon: Server, title: "Access control", body: "Row Level Security (RLS) on all database tables. SHA-256 hashed API keys — plaintext never stored." },
                { icon: Shield, title: "Admin sessions", body: "HttpOnly, Secure, SameSite=Strict cookies. Session expiry enforced." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="p-4 rounded-xl border border-border-light bg-white">
                  <Icon size={18} className="text-action-teal mb-2" />
                  <div className="font-bold text-deep-navy text-sm mb-1">{title}</div>
                  <div className="text-xs text-gov-slate leading-relaxed">{body}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Data Residency */}
          <section>
            <h2 className="text-xl font-extrabold text-deep-navy mb-2">
              Data residency
            </h2>
            <p className="text-gov-slate text-sm mb-5">
              All primary data is processed and stored within Australia.
            </p>
            <div className="rounded-xl border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gov-slate">Component</th>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gov-slate">Region</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {[
                    { component: "Database (PostgreSQL)", region: "Sydney (ap-southeast-2)" },
                    { component: "Application hosting", region: "Sydney (syd1)" },
                    { component: "Object storage", region: "Oceania (Cloudflare R2)" },
                    { component: "Rate limiting", region: "Singapore (Upstash Redis)" },
                    { component: "AI processing", region: "USA (Anthropic Claude — query data, no storage)" },
                  ].map(({ component, region }) => (
                    <tr key={component} className="bg-white">
                      <td className="px-4 py-3 font-medium text-deep-navy text-xs">{component}</td>
                      <td className="px-4 py-3 text-gov-slate text-xs">{region}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Sub-processors */}
          <section>
            <h2 className="text-xl font-extrabold text-deep-navy mb-2">
              Sub-processors
            </h2>
            <p className="text-gov-slate text-sm mb-5">
              Third-party services used to deliver Ask Arthur. Each holds security certifications.
            </p>
            <div className="rounded-xl border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gov-slate">Provider</th>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gov-slate hidden md:table-cell">Purpose</th>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gov-slate">Certifications</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {subProcessors.map(({ name, purpose, cert }) => (
                    <tr key={name} className="bg-white">
                      <td className="px-4 py-3 font-medium text-deep-navy text-xs">{name}</td>
                      <td className="px-4 py-3 text-gov-slate text-xs hidden md:table-cell">{purpose}</td>
                      <td className="px-4 py-3 text-gov-slate text-xs">{cert}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Incident response */}
          <section className="p-5 rounded-xl border border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-900 mb-1">Security incident?</div>
                <p className="text-amber-800 text-sm leading-relaxed">
                  Report suspected vulnerabilities or security incidents to{" "}
                  <a href="mailto:brendan@askarthur.au" className="underline font-medium">
                    brendan@askarthur.au
                  </a>
                  . We aim to respond within 24 hours and will notify affected clients
                  within 72 hours of confirming a breach.
                </p>
              </div>
            </div>
          </section>

          {/* Enterprise docs */}
          <section>
            <h2 className="text-xl font-extrabold text-deep-navy mb-2">
              Enterprise documentation
            </h2>
            <p className="text-gov-slate text-sm mb-5">
              Available on request for enterprise clients and vendors conducting due diligence.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                "Data Processing Agreement (DPA)",
                "Master Service Agreement (MSA)",
                "Service Level Agreement (SLA)",
                "Security Questionnaire (SIG Lite)",
                "Architecture overview",
                "Penetration test report (available Q3 2026)",
              ].map((doc) => (
                <a
                  key={doc}
                  href="mailto:brendan@askarthur.au"
                  className="flex items-center gap-2 p-3 rounded-xl border border-border-light bg-white hover:border-action-teal/40 transition-colors text-sm text-gov-slate"
                >
                  <Shield size={14} className="text-action-teal flex-shrink-0" />
                  {doc}
                </a>
              ))}
            </div>
            <p className="text-xs text-gov-slate mt-3">
              Email{" "}
              <a href="mailto:brendan@askarthur.au" className="text-action-teal font-medium">
                brendan@askarthur.au
              </a>{" "}
              to request any document.
            </p>
          </section>

          {/* Links */}
          <section className="flex flex-wrap gap-4 text-sm">
            <a href="/privacy" className="text-action-teal hover:underline font-medium">Privacy Policy</a>
            <a href="/terms" className="text-action-teal hover:underline font-medium">Terms of Service</a>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
