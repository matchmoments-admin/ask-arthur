import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { ArrowLeft, Download } from "lucide-react";
import "../document.css";

export const metadata: Metadata = {
  title: "Security Overview — Ask Arthur",
  description:
    "Ask Arthur's enterprise security and compliance posture. Architecture, controls, data residency, and sub-processors.",
  alternates: { canonical: "https://askarthur.au/trust/security-overview" },
  robots: { index: true, follow: true },
};

const DOC_VERSION = "1.0";
const DOC_DATE = "April 2026";
const DOC_CLASSIFICATION = "GENERAL USE";

export default function SecurityOverviewPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="screen-only">
        <Nav />
      </div>

      <main id="main-content" className="flex-1">
        {/* Screen-only top bar */}
        <div className="screen-only bg-slate-50 border-b border-border-light">
          <div className="max-w-[840px] mx-auto px-5 py-3 flex items-center justify-between text-sm">
            <a
              href="/trust"
              className="text-gov-slate hover:text-deep-navy inline-flex items-center gap-1.5 font-medium"
            >
              <ArrowLeft size={14} /> Back to Trust &amp; Security
            </a>
            <a
              href="/legal/ask-arthur-security-overview-v1.pdf"
              className="text-action-teal hover:text-deep-navy inline-flex items-center gap-1.5 font-medium"
            >
              <Download size={14} /> Download PDF
            </a>
          </div>
        </div>

        <article className="document">
          {/* COVER PAGE */}
          <section className="cover">
            <div className="cover-inner">
              <div className="cover-mark" aria-hidden="true">
                <svg
                  width="56"
                  height="56"
                  viewBox="0 0 56 56"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M28 4L48 14V28C48 38.5 39.5 47.5 28 50C16.5 47.5 8 38.5 8 28V14L28 4Z"
                    stroke="#001F3F"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M22 28L26 32L34 22"
                    stroke="#008A98"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="cover-eyebrow">Ask Arthur</div>
              <h1 className="cover-title">Security Overview</h1>
              <p className="cover-subtitle">
                Platform architecture, controls, and compliance posture
              </p>
              <div className="cover-classification">{DOC_CLASSIFICATION}</div>
              <div className="cover-meta">
                <div>{DOC_DATE}</div>
                <div>Version {DOC_VERSION}</div>
              </div>
            </div>
            <div className="cover-footer">
              Young Milton Pty Ltd · ABN 72 695 772 313 · askarthur.au
            </div>
          </section>

          {/* TABLE OF CONTENTS */}
          <section className="page">
            <h2 className="page-h2">Contents</h2>
            <ol className="toc">
              <li><span>1. Overview</span><span>3</span></li>
              <li><span>2. Platform Architecture</span><span>3</span></li>
              <li><span>3. Security Controls</span><span>4</span></li>
              <li><span>4. Operational Security</span><span>6</span></li>
              <li><span>5. Privacy &amp; Data Handling</span><span>7</span></li>
              <li><span>6. Compliance Roadmap</span><span>8</span></li>
              <li><span>7. Sub-Processors</span><span>8</span></li>
              <li><span>8. Incident Response &amp; Contact</span><span>9</span></li>
            </ol>
          </section>

          {/* 1. OVERVIEW */}
          <section className="page">
            <h2 className="page-h2">1. Overview</h2>
            <p>
              Ask Arthur is an Australian scam detection platform operated by
              Young Milton Pty Ltd. The service combines threat intelligence
              feeds, AI-assisted classification, and a sub-processor stack
              hosted primarily in Sydney to deliver real-time verdicts on
              suspicious content submitted via web app, browser extension,
              mobile app, B2B API, and chat-bot integrations.
            </p>
            <p>
              This document summarises the security, privacy, and operational
              controls that protect customer data. It is provided for general
              vendor due diligence and does not constitute a SOC 2 or ISO 27001
              attestation. Where formal attestation is required, contact
              <a href="mailto:brendan@askarthur.au"> brendan@askarthur.au</a>
              {" "}for our compliance roadmap and supplementary documentation under NDA.
            </p>

            {/* 2. ARCHITECTURE */}
            <h2 className="page-h2 mt-section">2. Platform Architecture</h2>

            <h3 className="page-h3">2.1 Deployment Model</h3>
            <p>
              Ask Arthur runs as a multi-tenant SaaS application on Vercel,
              with PostgreSQL hosted on Supabase (AWS Sydney region,
              ap-southeast-2). All primary data is processed and stored within
              Australia.
            </p>

            <h3 className="page-h3">2.2 Infrastructure</h3>
            <table className="data-table">
              <tbody>
                <tr><th>Web hosting</th><td>Vercel (Sydney edge, syd1)</td></tr>
                <tr><th>Database</th><td>Supabase PostgreSQL — Sydney (ap-southeast-2)</td></tr>
                <tr><th>Object storage</th><td>Cloudflare R2 (Oceania)</td></tr>
                <tr><th>Rate limiting</th><td>Upstash Redis (Singapore)</td></tr>
                <tr><th>AI processing</th><td>Anthropic Claude API (US — query data only, no storage or training)</td></tr>
                <tr><th>Email delivery</th><td>Resend (US)</td></tr>
                <tr><th>Disaster recovery</th><td>Supabase point-in-time recovery, 7-day window</td></tr>
              </tbody>
            </table>

            <h3 className="page-h3">2.3 Network Posture</h3>
            <p>
              No databases are exposed to the public internet. All ingress
              traffic terminates at the Vercel edge, which proxies to Next.js
              server functions over TLS 1.3. Outbound traffic to sub-processors
              uses authenticated TLS connections with SDK-issued credentials.
            </p>
          </section>

          {/* 3. SECURITY CONTROLS */}
          <section className="page">
            <h2 className="page-h2">3. Security Controls</h2>

            <h3 className="page-h3">3.1 Data Protection</h3>
            <table className="data-table">
              <thead>
                <tr><th>Control</th><th>Implementation</th></tr>
              </thead>
              <tbody>
                <tr><td>Encryption at rest</td><td>AES-256 via Supabase-managed KMS</td></tr>
                <tr><td>Encryption in transit</td><td>TLS 1.3 enforced; HSTS preload (max-age 2 years)</td></tr>
                <tr><td>PII scrubbing</td><td>12-pattern pipeline strips emails, cards, Medicare, TFN, SSN, AU/intl phones, IPs, BSBs, addresses, and names before storage</td></tr>
                <tr><td>Data retention</td><td>SAFE/SUSPICIOUS reports archived after 90 days; HIGH_RISK after 180 days; bot queue cleared at 24h</td></tr>
                <tr><td>Backups</td><td>Supabase daily encrypted backups; point-in-time recovery to any second within 7 days</td></tr>
                <tr><td>Secret hygiene</td><td>API keys SHA-256 hashed; plaintext never stored; timing-safe comparisons for all secret checks</td></tr>
              </tbody>
            </table>

            <h3 className="page-h3">3.2 Identity &amp; Access Management</h3>
            <table className="data-table">
              <thead>
                <tr><th>Surface</th><th>Method</th></tr>
              </thead>
              <tbody>
                <tr><td>End-user authentication</td><td>Supabase Auth (PKCE) — email/password, magic link; MFA available</td></tr>
                <tr><td>Session management</td><td>HttpOnly, Secure, SameSite=Strict cookies; server-side JWT validation via <code>getUser()</code></td></tr>
                <tr><td>Authorisation</td><td>PostgreSQL Row Level Security on every multi-tenant table</td></tr>
                <tr><td>B2B API</td><td>Bearer tokens; SHA-256 hashed; per-key rate limits; max 5 active keys per user</td></tr>
                <tr><td>Browser extension</td><td>Per-install ECDSA P-256 signature; non-extractable private key in IndexedDB; nonce replay protection in Redis</td></tr>
                <tr><td>Bot webhooks</td><td>Platform HMAC verification (Telegram secret token, WhatsApp SHA-256, Slack v0 with 5-min replay window)</td></tr>
                <tr><td>Privileged access</td><td>Admin panel uses dual-mode auth (Supabase admin role with HMAC cookie fallback); 24h session expiry</td></tr>
              </tbody>
            </table>
          </section>

          <section className="page">
            <h3 className="page-h3">3.3 Application Security</h3>
            <table className="data-table">
              <thead>
                <tr><th>Control</th><th>Implementation</th></tr>
              </thead>
              <tbody>
                <tr><td>Input validation</td><td>All external input validated with Zod schemas; 10MB payload cap</td></tr>
                <tr><td>Prompt-injection defence</td><td>Unicode sanitization (11 invisible-char classes), nonce-based XML delimiters, sandwich defence, 14 regex pattern detectors</td></tr>
                <tr><td>HTML sanitization</td><td>Email scans strip comments, style/script blocks, hidden elements, and data attributes server-side before AI analysis</td></tr>
                <tr><td>Content Security Policy</td><td>No <code>unsafe-eval</code>; <code>frame-ancestors &apos;none&apos;</code>; explicit allowlist for connect/script/style</td></tr>
                <tr><td>Rate limiting</td><td>Two layers: edge middleware (60/min per IP on API routes) + per-route burst+daily limits keyed to install/IP/key. Fail-closed in production.</td></tr>
                <tr><td>Code review</td><td>All changes via GitHub PR; required Vercel preview deploy gating; squash-merge to main</td></tr>
                <tr><td>Dependency scanning</td><td><code>pnpm audit</code> for Node; <code>pip audit</code> for Python pipeline; lockfiles committed</td></tr>
                <tr><td>SSRF protection</td><td>Image proxy uses domain allowlist, manual redirect handling, content-type validation, 5MB / 10s caps</td></tr>
              </tbody>
            </table>

            <h3 className="page-h3">3.4 Infrastructure Security</h3>
            <table className="data-table">
              <thead>
                <tr><th>Control</th><th>Implementation</th></tr>
              </thead>
              <tbody>
                <tr><td>DDoS protection</td><td>Vercel + Cloudflare edge (sub-processors)</td></tr>
                <tr><td>Patch management</td><td>Dependencies patched within 7 days for high severity; managed runtime auto-patched (Vercel, Supabase)</td></tr>
                <tr><td>Database hardening</td><td>RLS-enforced; <code>SECURITY DEFINER</code> RPCs scoped with <code>SET search_path = public</code>; admin-only RPCs revoked from <code>public/anon/authenticated</code></td></tr>
                <tr><td>Webhook idempotency</td><td>Stripe events deduplicated via <code>stripe_event_log</code> insert-with-conflict gate</td></tr>
                <tr><td>Secret management</td><td>Environment variables via Vercel; never committed; quarterly rotation policy for high-sensitivity keys</td></tr>
              </tbody>
            </table>
          </section>

          {/* 4. OPERATIONAL SECURITY */}
          <section className="page">
            <h2 className="page-h2">4. Operational Security</h2>

            <h3 className="page-h3">4.1 Logging &amp; Monitoring</h3>
            <ul className="bullet-list">
              <li><strong>Application logs</strong> — structured JSON via <code>@askarthur/utils/logger</code>, retained in Vercel Observability for 30 days</li>
              <li><strong>Database audit</strong> — Supabase log explorer; advisor scans run weekly via the MCP tooling</li>
              <li><strong>Cost telemetry</strong> — <code>cost_telemetry</code> table records every paid-API call with feature/provider tagging; <code>/admin/costs</code> dashboard surfaces anomalies</li>
              <li><strong>Health monitoring</strong> — <code>/admin/health</code> shows queue depth, archive counts, Stripe idempotency log, and feed staleness</li>
              <li><strong>Alerting</strong> — daily Telegram threshold alerts (default $2 USD/day) and weekly week-over-week digest</li>
            </ul>

            <h3 className="page-h3">4.2 Change Management</h3>
            <ul className="bullet-list">
              <li>Every change shipped via a GitHub pull request from a feature branch off <code>main</code></li>
              <li>Vercel preview deployment must pass before merge; squash-merge preserves a linear file tree for cache hits</li>
              <li>Migrations are idempotent (<code>CREATE TABLE IF NOT EXISTS</code>, <code>DROP POLICY IF EXISTS</code>) and applied via the Supabase MCP with advisor verification</li>
              <li>Destructive or long-running migrations require a runbook and maintenance window</li>
              <li>Detailed commit messages document the technical hypothesis, approach, and outcome — preserved as contemporaneous R&amp;D evidence</li>
            </ul>

            <h3 className="page-h3">4.3 Backup &amp; Recovery</h3>
            <ul className="bullet-list">
              <li><strong>Recovery Point Objective (RPO):</strong> &lt; 1 minute (Supabase point-in-time recovery)</li>
              <li><strong>Recovery Time Objective (RTO):</strong> &lt; 4 hours for primary database restore</li>
              <li><strong>Application:</strong> stateless; Vercel rolls back to a prior deployment in &lt; 60 seconds</li>
              <li><strong>Object storage:</strong> Cloudflare R2 with versioning enabled on evidence buckets</li>
            </ul>
          </section>

          {/* 5. PRIVACY */}
          <section className="page">
            <h2 className="page-h2">5. Privacy &amp; Data Handling</h2>

            <h3 className="page-h3">5.1 Privacy Principles</h3>
            <ul className="bullet-list">
              <li><strong>Data minimisation</strong> — submitted text and images are processed for analysis and immediately discarded; only PII-scrubbed summaries are retained for HIGH_RISK verdicts</li>
              <li><strong>Purpose limitation</strong> — customer data is used solely for delivering the contracted service; no secondary marketing use</li>
              <li><strong>Customer ownership</strong> — all customer-linked data remains the customer&apos;s property and is portable on request</li>
              <li><strong>AI training</strong> — Anthropic&apos;s commercial terms exclude API customer data from model training; Ask Arthur does not operate any in-house training pipeline</li>
            </ul>

            <h3 className="page-h3">5.2 Australian Privacy Act 1988 (Cth)</h3>
            <p>
              Ask Arthur operates under the 13 Australian Privacy Principles
              and provides the following self-service rights to authenticated users:
            </p>
            <table className="data-table">
              <thead>
                <tr><th>Right</th><th>Endpoint</th></tr>
              </thead>
              <tbody>
                <tr><td>Access (APP 12)</td><td><code>GET /api/user/export-data</code> — JSON bundle of all data linked to the caller</td></tr>
                <tr><td>Erasure (APP 11/13)</td><td><code>POST /api/user/delete-account</code> — cascades to <code>user_profiles</code> and owned <code>family_groups</code></td></tr>
                <tr><td>Rectification</td><td>Account settings UI; bulk corrections via <a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a></td></tr>
                <tr><td>Data breach notification (Pt IIIC)</td><td>Eligible breaches notified to the OAIC and affected individuals as soon as practicable</td></tr>
              </tbody>
            </table>

            <h3 className="page-h3">5.3 Cross-Border Data Transfers</h3>
            <p>
              Where overseas processing is necessary (AI analysis via Anthropic
              US, email delivery via Resend US, rate limiting via Upstash
              Singapore), Ask Arthur ensures equivalent protection through
              contractual safeguards and discloses each transfer in the
              public sub-processor list.
            </p>
          </section>

          {/* 6. COMPLIANCE */}
          <section className="page">
            <h2 className="page-h2">6. Compliance Roadmap</h2>
            <table className="data-table">
              <thead>
                <tr><th>Framework</th><th>Status</th><th>Detail</th></tr>
              </thead>
              <tbody>
                <tr><td>Australian Privacy Act 1988</td><td>Compliant</td><td>13 APPs covered; APP 12 + 13 endpoints live</td></tr>
                <tr><td>ASD Essential Eight (ML1)</td><td>Self-assessed</td><td>Application control, patching, MFA, daily backups in place</td></tr>
                <tr><td>SOC 2 Type I</td><td>In progress</td><td>Target Q3 2026</td></tr>
                <tr><td>SOC 2 Type II</td><td>Planned</td><td>Target H1 2027 following Type I attestation</td></tr>
                <tr><td>ISO 27001</td><td>Planned</td><td>Target 2027</td></tr>
                <tr><td>IRAP assessment</td><td>On request</td><td>Available for Australian Government engagements</td></tr>
              </tbody>
            </table>

            <h2 className="page-h2 mt-section">7. Sub-Processors</h2>
            <p>
              The following third parties process customer data on our behalf.
              Each holds independent security certifications. The current list
              is also published at{" "}
              <a href="https://askarthur.au/trust">askarthur.au/trust</a>.
            </p>
            <table className="data-table">
              <thead>
                <tr><th>Provider</th><th>Region</th><th>Purpose</th><th>Certifications</th></tr>
              </thead>
              <tbody>
                <tr><td>Supabase, Inc.</td><td>USA / Sydney</td><td>Database hosting</td><td>SOC 2 Type II</td></tr>
                <tr><td>Vercel, Inc.</td><td>USA / Sydney</td><td>Application hosting</td><td>SOC 2 + ISO 27001</td></tr>
                <tr><td>Cloudflare, Inc.</td><td>USA / Oceania</td><td>CDN + object storage</td><td>SOC 2 + ISO 27001</td></tr>
                <tr><td>Anthropic, PBC</td><td>USA</td><td>AI analysis</td><td>Enterprise DPA; SOC 2</td></tr>
                <tr><td>Twilio, Inc.</td><td>USA</td><td>Phone intelligence</td><td>SOC 2 Type II</td></tr>
                <tr><td>Upstash, Inc.</td><td>Singapore</td><td>Rate limiting</td><td>SOC 2</td></tr>
                <tr><td>Resend, Inc.</td><td>USA</td><td>Email delivery</td><td>SOC 2</td></tr>
                <tr><td>Stripe, Inc.</td><td>USA</td><td>Billing</td><td>PCI DSS Level 1; SOC 2</td></tr>
              </tbody>
            </table>
          </section>

          {/* 8. CONTACT */}
          <section className="page">
            <h2 className="page-h2">8. Incident Response &amp; Contact</h2>

            <h3 className="page-h3">8.1 Incident Response</h3>
            <ul className="bullet-list">
              <li><strong>Triage</strong> — within 24 hours of confirmed report</li>
              <li><strong>Customer notification</strong> — affected customers notified within 72 hours of confirming a breach</li>
              <li><strong>Regulator notification</strong> — eligible breaches reported to the OAIC under the Notifiable Data Breaches scheme as soon as practicable</li>
              <li><strong>Post-incident review</strong> — written within 14 days of remediation; available to enterprise customers under NDA</li>
            </ul>

            <h3 className="page-h3">8.2 Vulnerability Disclosure</h3>
            <p>
              Researchers and customers can report suspected vulnerabilities
              to <a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a>.
              We do not currently operate a paid bug bounty programme but will
              acknowledge responsible disclosures publicly with the reporter&apos;s
              consent.
            </p>

            <h3 className="page-h3">8.3 Contact</h3>
            <table className="data-table">
              <tbody>
                <tr><th>Security &amp; incidents</th><td><a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a></td></tr>
                <tr><th>Privacy &amp; data requests</th><td><a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a></td></tr>
                <tr><th>Vendor due diligence / DPA</th><td><a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a></td></tr>
                <tr><th>Legal entity</th><td>Young Milton Pty Ltd · ABN 72 695 772 313</td></tr>
                <tr><th>Web</th><td><a href="https://askarthur.au">askarthur.au</a></td></tr>
              </tbody>
            </table>

            <p className="closing-note">
              Further detail on our security and compliance programme is
              available under NDA. This document is reviewed at minimum
              annually and re-issued whenever a material control changes.
            </p>
          </section>
        </article>
      </main>

      <div className="screen-only">
        <Footer />
      </div>
    </div>
  );
}
