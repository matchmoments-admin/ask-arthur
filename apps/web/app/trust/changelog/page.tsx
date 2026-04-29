import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Security Changelog — Ask Arthur",
  description:
    "Append-only log of security and compliance updates to the Ask Arthur platform.",
  alternates: { canonical: "https://askarthur.au/trust/changelog" },
};

type Severity = "control" | "policy" | "incident" | "infrastructure";

type ChangelogEntry = {
  date: string; // ISO YYYY-MM-DD
  title: string;
  severity: Severity;
  body: string;
  prs?: Array<{ number: number; label?: string }>;
};

// Newest first. When adding entries, prepend rather than append.
const entries: ChangelogEntry[] = [
  {
    date: "2026-04-29",
    title: "Trust centre upgrade — Security Overview PDF, DPA template, sub-processor list",
    severity: "policy",
    body:
      "Published a downloadable Security Overview document, a customer-executable Data Processing Agreement template, and a sub-processor CSV. /trust now hosts the full vendor due-diligence pack.",
  },
  {
    date: "2026-04-23",
    title: "Migration v78 — clears P0 advisor ERRORs (RLS + search_path)",
    severity: "control",
    body:
      "Tightened Row Level Security policies and pinned SECURITY DEFINER RPCs to a stable search_path. Cleared the priority-zero findings from the Supabase advisor security audit. Hygiene work for the long tail tracked in BACKLOG.",
  },
  {
    date: "2026-04-15",
    title: "Extension — per-install ECDSA P-256 signature with non-extractable keys",
    severity: "control",
    body:
      "Browser extension requests are now signed with an ECDSA P-256 keypair generated locally with extractable: false. Public keys register through a Cloudflare Turnstile-gated endpoint with IP rate limiting. Replay protection enforced via Redis nonce SETNX with a 10-minute TTL aligned to the ±5-minute timestamp skew window.",
  },
  {
    date: "2026-04-02",
    title: "Stripe webhook idempotency via stripe_event_log",
    severity: "infrastructure",
    body:
      "Stripe webhook handler now deduplicates events at the database layer using an insert-with-conflict gate on event.id. Duplicate deliveries return 200 without re-running side effects.",
  },
  {
    date: "2026-03-20",
    title: "PII scrubbing — 12 patterns now cover AU mobile, BSB, TFN, and Medicare",
    severity: "control",
    body:
      "Expanded the pre-storage PII scrubber to cover Australian-specific identifiers (Tax File Number, Medicare, BSB, AU mobile and landline). Order matters: more specific patterns run first to avoid generic phone-number masking shadowing them.",
  },
  {
    date: "2026-03-08",
    title: "CSP hardened — removed unsafe-eval, added frame-ancestors none",
    severity: "control",
    body:
      "Content Security Policy at the edge now drops unsafe-eval, blocks framing entirely (frame-ancestors none + X-Frame-Options DENY), and enforces upgrade-insecure-requests. HSTS preload submission accepted for askarthur.au.",
  },
  {
    date: "2026-02-12",
    title: "Rate limiter — production now fails closed",
    severity: "control",
    body:
      "Two-layer rate limiter (edge middleware + per-route burst+daily limits) returns 503 in production when Upstash Redis is unavailable, rather than allowing requests through. Local dev still fails open.",
  },
  {
    date: "2026-01-28",
    title: "Admin auth — HMAC cookie with 24h expiry replaces basic auth",
    severity: "control",
    body:
      "Admin panel access migrated to a cookie-based HMAC scheme (SHA-256, 24h expiry, timing-safe comparison). Supabase admin role check sits in front as the primary auth path with the HMAC cookie as fallback for dual-mode operation.",
  },
];

const severityStyles: Record<Severity, { label: string; className: string }> = {
  control: { label: "Security control", className: "bg-deep-navy/5 text-deep-navy border-deep-navy/20" },
  policy: { label: "Policy / docs", className: "bg-action-teal/10 text-action-teal-text border-action-teal/30" },
  incident: { label: "Incident", className: "bg-amber-50 text-amber-800 border-amber-200" },
  infrastructure: { label: "Infrastructure", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function SecurityChangelogPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <section className="bg-deep-navy text-white py-12 px-5">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/trust"
            className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium mb-4"
          >
            <ArrowLeft size={14} /> Trust &amp; Security
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck size={28} strokeWidth={1.5} className="opacity-80" />
            <h1 className="text-3xl font-extrabold">Security Changelog</h1>
          </div>
          <p className="text-white/70 text-sm leading-relaxed max-w-lg">
            Append-only log of security, privacy, and infrastructure updates
            to the Ask Arthur platform. Updated whenever a control, policy,
            or sub-processor changes materially.
          </p>
        </div>
      </section>

      <main id="main-content" className="flex-1">
        <div className="max-w-2xl mx-auto px-5 py-12">
          <ol className="space-y-8">
            {entries.map((entry) => {
              const sev = severityStyles[entry.severity];
              return (
                <li key={entry.date + entry.title} className="relative pl-6 border-l-2 border-border-light">
                  <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-action-teal ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <time dateTime={entry.date} className="text-xs font-bold uppercase tracking-wider text-gov-slate">
                      {formatDate(entry.date)}
                    </time>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${sev.className}`}>
                      {sev.label}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-deep-navy mb-1.5 leading-snug">{entry.title}</h2>
                  <p className="text-sm text-gov-slate leading-relaxed">{entry.body}</p>
                  {entry.prs && entry.prs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.prs.map((pr) => (
                        <a
                          key={pr.number}
                          href={`https://github.com/consulting-brendan/safeverify/pull/${pr.number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-action-teal hover:underline"
                        >
                          #{pr.number}{pr.label ? ` — ${pr.label}` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <section className="mt-12 p-5 rounded-xl border border-border-light bg-slate-50">
            <h2 className="text-sm font-bold text-deep-navy mb-2">Reporting a security issue</h2>
            <p className="text-sm text-gov-slate leading-relaxed">
              Email{" "}
              <a href="mailto:brendan@askarthur.au" className="text-action-teal font-medium hover:underline">
                brendan@askarthur.au
              </a>
              {" "}with reproduction steps. We triage within 24 hours and notify
              affected customers within 72 hours of confirming a breach.
            </p>
          </section>

          <p className="text-xs text-gov-slate mt-8 text-center">
            Older entries are retained in <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">SECURITY.md</code> in the public repository.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
