import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { ArrowLeft, Download } from "lucide-react";
import "../document.css";

export const metadata: Metadata = {
  title: "Data Processing Agreement — Ask Arthur",
  description:
    "Ask Arthur's Data Processing Agreement template. Australian Privacy Act 1988 + GDPR-aligned terms for B2B and enterprise customers.",
  alternates: { canonical: "https://askarthur.au/trust/dpa" },
  robots: { index: true, follow: true },
};

const DOC_VERSION = "1.0";
const DOC_DATE = "April 2026";

export default function DpaPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="screen-only">
        <Nav />
      </div>

      <main id="main-content" className="flex-1">
        <div className="screen-only bg-slate-50 border-b border-border-light">
          <div className="max-w-[840px] mx-auto px-5 py-3 flex items-center justify-between text-sm">
            <a
              href="/trust"
              className="text-gov-slate hover:text-deep-navy inline-flex items-center gap-1.5 font-medium"
            >
              <ArrowLeft size={14} /> Back to Trust &amp; Security
            </a>
            <a
              href="/legal/ask-arthur-dpa-template-v1.pdf"
              className="text-action-teal hover:text-deep-navy inline-flex items-center gap-1.5 font-medium"
            >
              <Download size={14} /> Download PDF
            </a>
          </div>
        </div>

        <article className="document">
          {/* COVER */}
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
                    d="M14 12H38L46 22V46C46 47.1 45.1 48 44 48H14C12.9 48 12 47.1 12 46V14C12 12.9 12.9 12 14 12Z"
                    stroke="#001F3F"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M38 12V22H46"
                    stroke="#001F3F"
                    strokeWidth="2"
                  />
                  <path
                    d="M19 30H39M19 36H39M19 42H32"
                    stroke="#008A98"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="cover-eyebrow">Ask Arthur</div>
              <h1 className="cover-title">Data Processing Agreement</h1>
              <p className="cover-subtitle">
                Template terms for B2B and enterprise customers
              </p>
              <div className="cover-classification">Draft · Sample Only</div>
              <p className="cover-disclaimer">
                Subject to review by qualified Australian legal counsel before
                execution. This sample is provided for vendor due-diligence
                review and is not a binding offer of contract terms.
              </p>
              <div className="cover-meta">
                <div>{DOC_DATE}</div>
                <div>Version {DOC_VERSION}</div>
              </div>
            </div>
            <div className="cover-footer">
              Young Milton Pty Ltd · ABN 72 695 772 313 · askarthur.au
            </div>
          </section>

          {/* PREAMBLE */}
          <section className="page">
            <h2 className="page-h2">Preamble</h2>
            <p>
              This Data Processing Agreement (&quot;<strong>DPA</strong>&quot;) forms
              part of the agreement between the customer (&quot;<strong>Customer</strong>&quot;
              or &quot;<strong>Controller</strong>&quot;) and Young Milton Pty Ltd
              ABN 72 695 772 313 trading as Ask Arthur (&quot;<strong>Ask Arthur</strong>&quot;
              or &quot;<strong>Processor</strong>&quot;) for the provision of the
              Ask Arthur scam-detection platform (the &quot;<strong>Service</strong>&quot;).
            </p>
            <p>
              This is a template. To execute, complete the variables in
              Schedule&nbsp;A and return a signed copy to{" "}
              <a href="mailto:brendan@askarthur.au">brendan@askarthur.au</a>.
              Ask Arthur will counter-sign and return within 5 business days.
              Where this template conflicts with a customer-specific DPA
              negotiated and counter-signed by both parties, the
              customer-specific DPA prevails.
            </p>

            <h2 className="page-h2 mt-section">1. Definitions</h2>
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Personal Information</th>
                  <td>
                    Has the meaning given in section 6 of the Privacy Act 1988
                    (Cth), and includes &quot;personal data&quot; as defined in
                    Article 4 of the EU General Data Protection Regulation
                    (&quot;<strong>GDPR</strong>&quot;) where the GDPR applies.
                  </td>
                </tr>
                <tr>
                  <th>Customer Data</th>
                  <td>
                    Any Personal Information processed by Ask Arthur on the
                    Customer&apos;s behalf in connection with the Service.
                  </td>
                </tr>
                <tr>
                  <th>Sub-Processor</th>
                  <td>
                    Any third party engaged by Ask Arthur to process Customer
                    Data, listed at askarthur.au/trust.
                  </td>
                </tr>
                <tr>
                  <th>Eligible Data Breach</th>
                  <td>
                    Has the meaning given in Part IIIC of the Privacy Act 1988
                    (Cth) and equivalent terms (&quot;personal data breach&quot;)
                    under Article 4(12) GDPR where applicable.
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 2. ROLES */}
          <section className="page">
            <h2 className="page-h2">2. Roles &amp; Scope</h2>
            <p>
              The Customer is the Controller and Ask Arthur is the Processor in
              respect of Customer Data. Each party is independently responsible
              for compliance with applicable privacy laws, including (without
              limitation) the Privacy Act 1988 (Cth) and the Australian Privacy
              Principles, the GDPR where the Customer or Customer Data is in
              scope, and the UK Data Protection Act 2018.
            </p>

            <h3 className="page-h3">2.1 Subject matter and duration</h3>
            <p>
              Ask Arthur processes Customer Data for the purpose of providing
              the Service for the duration of the underlying agreement, and for
              the additional retention periods set out in clause 9.
            </p>

            <h3 className="page-h3">2.2 Categories of data subjects and Personal Information</h3>
            <p>
              The categories of data subjects and Personal Information are set
              out in Schedule A.
            </p>

            <h2 className="page-h2 mt-section">3. Processor Obligations</h2>
            <p>Ask Arthur will:</p>
            <ul className="bullet-list">
              <li>process Customer Data only on the documented instructions of the Customer, including as set out in the underlying agreement and the Service&apos;s configuration options;</li>
              <li>maintain the technical and organisational measures described in Schedule B;</li>
              <li>ensure that personnel authorised to access Customer Data are bound by appropriate confidentiality obligations;</li>
              <li>notify the Customer without undue delay, and in any event within 72 hours, after becoming aware of an Eligible Data Breach affecting Customer Data;</li>
              <li>provide reasonable assistance to the Customer in responding to data subject requests received under the Privacy Act 1988 (Cth) or GDPR Articles 12–22;</li>
              <li>at the Customer&apos;s choice, return or delete Customer Data on termination of the Service in accordance with clause 9;</li>
              <li>make available, on request, the information necessary to demonstrate compliance with this DPA, including the security overview and most recent third-party assessments under NDA.</li>
            </ul>
          </section>

          {/* 4-5 SUB-PROCESSORS + TRANSFERS */}
          <section className="page">
            <h2 className="page-h2">4. Sub-Processors</h2>
            <p>
              The Customer authorises Ask Arthur to engage the Sub-Processors
              listed at <a href="https://askarthur.au/trust">askarthur.au/trust</a>{" "}
              (the &quot;<strong>Sub-Processor List</strong>&quot;) for the purposes
              described.
            </p>
            <p>
              Ask Arthur will give the Customer at least 30 days&apos; notice
              before engaging any new Sub-Processor with access to Customer
              Data. Notice will be given by updating the Sub-Processor List
              and, where the Customer has subscribed, sending an email to the
              Customer&apos;s designated privacy contact.
            </p>
            <p>
              The Customer may object to a new Sub-Processor on reasonable
              grounds within the notice period. If the parties cannot agree a
              resolution, the Customer&apos;s sole remedy is to terminate the
              affected portion of the Service for convenience.
            </p>

            <h2 className="page-h2 mt-section">5. International Transfers</h2>
            <p>
              Customer Data is processed primarily in Australia (Sydney). Where
              transfer to a Sub-Processor outside Australia is necessary, Ask
              Arthur ensures equivalent protection through one or more of:
            </p>
            <ul className="bullet-list">
              <li>contractual safeguards with the Sub-Processor that obligate it to comply with the Australian Privacy Principles;</li>
              <li>where applicable, the European Commission Standard Contractual Clauses or the UK International Data Transfer Addendum;</li>
              <li>independent certifications held by the Sub-Processor (e.g. SOC 2, ISO 27001).</li>
            </ul>
            <p>
              The current location of each Sub-Processor is published in the
              Sub-Processor List.
            </p>
          </section>

          {/* 6-9 SECURITY, RIGHTS, AUDIT, RETURN */}
          <section className="page">
            <h2 className="page-h2">6. Security</h2>
            <p>
              Ask Arthur implements and maintains the technical and
              organisational measures set out in Schedule B, which the parties
              acknowledge are appropriate to the nature, scope, context and
              purposes of the processing and the risk to Customer Data. Ask
              Arthur reviews these measures at least annually and updates them
              to reflect material changes in risk.
            </p>

            <h2 className="page-h2 mt-section">7. Data Subject Rights</h2>
            <p>
              Where a data subject contacts Ask Arthur directly, Ask Arthur
              will redirect the request to the Customer without responding to
              the substance of the request, unless legally required to do
              otherwise. The Customer may use the self-service endpoints
              published in the Service to fulfil access and erasure requests
              for individuals whose accounts the Customer administers.
            </p>

            <h2 className="page-h2 mt-section">8. Audit</h2>
            <p>
              Ask Arthur will provide, on reasonable written request and not
              more than once in any 12-month period (or more frequently if
              required by a regulator or following an Eligible Data Breach):
            </p>
            <ul className="bullet-list">
              <li>the most recent Security Overview document and any third-party assessment reports it then holds;</li>
              <li>responses to a reasonable security questionnaire (e.g. SIG Lite, CAIQ) under NDA;</li>
              <li>where the foregoing is insufficient and the Customer is a regulated entity with an enforceable audit obligation, an on-site or remote audit at the Customer&apos;s expense, conducted on at least 30 days&apos; written notice and during business hours.</li>
            </ul>

            <h2 className="page-h2 mt-section">9. Return &amp; Deletion</h2>
            <p>
              On termination of the Service, the Customer may export Customer
              Data via the Service&apos;s data export endpoints for a period of
              30 days. After 30 days, Ask Arthur will delete Customer Data from
              live systems. Backup copies are retained for up to 7 days under
              point-in-time recovery and are then automatically expired.
              Aggregated, de-identified data that no longer constitutes
              Personal Information may be retained indefinitely for the purpose
              of improving the Service.
            </p>
          </section>

          {/* 10 BREACH + 11 GENERAL */}
          <section className="page">
            <h2 className="page-h2">10. Notification of Eligible Data Breach</h2>
            <p>
              Where Ask Arthur becomes aware of an Eligible Data Breach
              affecting Customer Data, Ask Arthur will notify the Customer
              without undue delay and in any event within 72 hours of becoming
              aware. The notification will include, to the extent then known:
            </p>
            <ul className="bullet-list">
              <li>the nature of the breach, including the categories and approximate number of data subjects and records concerned;</li>
              <li>the likely consequences of the breach;</li>
              <li>the measures taken or proposed to address the breach and mitigate its effects;</li>
              <li>the contact point for further information.</li>
            </ul>
            <p>
              The Customer remains responsible for any notification to the
              Office of the Australian Information Commissioner under Part IIIC
              of the Privacy Act 1988 (Cth), and to supervisory authorities and
              data subjects where the GDPR applies, except to the extent the
              Customer expressly delegates this responsibility in writing.
            </p>

            <h2 className="page-h2 mt-section">11. General</h2>

            <h3 className="page-h3">11.1 Order of precedence</h3>
            <p>
              In the event of conflict between this DPA and the underlying
              agreement, this DPA prevails to the extent of the conflict in
              respect of the processing of Customer Data.
            </p>

            <h3 className="page-h3">11.2 Governing law</h3>
            <p>
              This DPA is governed by the laws of New South Wales, Australia.
              The parties submit to the non-exclusive jurisdiction of the
              courts of New South Wales.
            </p>

            <h3 className="page-h3">11.3 Liability</h3>
            <p>
              Liability under this DPA is subject to the limitations and
              exclusions in the underlying agreement.
            </p>

            <h3 className="page-h3">11.4 Severability</h3>
            <p>
              If any provision of this DPA is held to be invalid or
              unenforceable, the remainder of the DPA continues in force.
            </p>
          </section>

          {/* SCHEDULE A */}
          <section className="page">
            <h2 className="page-h2">Schedule A — Description of Processing</h2>
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Subject matter</th>
                  <td>Provision of the Ask Arthur scam-detection Service.</td>
                </tr>
                <tr>
                  <th>Nature and purpose</th>
                  <td>Receiving, classifying, and returning verdicts on suspicious content submitted by Customer end users; supporting B2B integrations.</td>
                </tr>
                <tr>
                  <th>Categories of data subjects</th>
                  <td>Customer&apos;s authorised end users; Customer&apos;s administrators; individuals identified in content submitted to the Service.</td>
                </tr>
                <tr>
                  <th>Categories of Personal Information</th>
                  <td>Email address; account identifier; submitted content (which may incidentally contain identifiers, contact details, or financial data); IP address (hashed).</td>
                </tr>
                <tr>
                  <th>Special categories</th>
                  <td>None intended. Customer should not submit special category data; if incidentally submitted, it is processed for analysis and immediately discarded except for PII-scrubbed summaries of HIGH_RISK verdicts.</td>
                </tr>
                <tr>
                  <th>Frequency of processing</th>
                  <td>Continuous for the duration of the Service.</td>
                </tr>
                <tr>
                  <th>Retention</th>
                  <td>SAFE / SUSPICIOUS reports archived after 90 days. HIGH_RISK reports archived after 180 days. Bot queue records cleared at status transition; rows hard-deleted after 24 hours.</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* SCHEDULE B */}
          <section className="page">
            <h2 className="page-h2">Schedule B — Technical &amp; Organisational Measures</h2>
            <p>
              Ask Arthur implements the following measures, summarised here and
              described in detail in the Security Overview document available
              at <a href="https://askarthur.au/trust/security-overview">askarthur.au/trust/security-overview</a>.
            </p>
            <table className="data-table">
              <tbody>
                <tr><th>Encryption at rest</th><td>AES-256 via Supabase-managed KMS</td></tr>
                <tr><th>Encryption in transit</th><td>TLS 1.3; HSTS preload</td></tr>
                <tr><th>Authentication</th><td>Supabase Auth with PKCE; MFA available; HttpOnly secure cookies</td></tr>
                <tr><th>Authorisation</th><td>PostgreSQL Row Level Security on all multi-tenant tables</td></tr>
                <tr><th>Network</th><td>No publicly addressable databases; all ingress via Vercel edge</td></tr>
                <tr><th>Logging</th><td>Structured application logs, 30-day retention; cost telemetry; access audit via Supabase log explorer</td></tr>
                <tr><th>Vulnerability management</th><td>Dependency scanning; managed runtime auto-patching; high-severity vulnerabilities patched within 7 days</td></tr>
                <tr><th>Incident response</th><td>24-hour triage; 72-hour customer notification of confirmed breach</td></tr>
                <tr><th>Backup &amp; recovery</th><td>Supabase point-in-time recovery (7-day window); RPO &lt; 1 minute; RTO &lt; 4 hours</td></tr>
                <tr><th>Personnel</th><td>Confidentiality obligations; principle of least privilege; background-check requirement for engineering personnel handling production data</td></tr>
              </tbody>
            </table>

            <p className="closing-note">
              This document is a template for vendor due diligence. It does
              not become binding until counter-signed by both parties.
            </p>
          </section>

          {/* SIGNATURE */}
          <section className="page">
            <h2 className="page-h2">Signature Page</h2>
            <p>
              By signing below, the parties agree to be bound by this Data
              Processing Agreement.
            </p>

            <div style={{ marginTop: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px" }}>
              <div>
                <div style={{ fontSize: "10pt", fontWeight: 700, color: "#001f3f", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>
                  For the Customer
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Name</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px" }} />
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Title</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px" }} />
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Entity</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px" }} />
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Signature</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "40px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Date</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px" }} />
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10pt", fontWeight: 700, color: "#001f3f", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>
                  For Ask Arthur
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Name</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px", paddingBottom: "2px", display: "flex", alignItems: "flex-end", color: "#001f3f", fontWeight: 600 }}>Brendan Milton</div>
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Title</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px", paddingBottom: "2px", display: "flex", alignItems: "flex-end", color: "#001f3f", fontWeight: 600 }}>Director</div>
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Entity</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px", paddingBottom: "2px", display: "flex", alignItems: "flex-end", color: "#001f3f", fontWeight: 600 }}>Young Milton Pty Ltd · ABN 72 695 772 313</div>
                </div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Signature</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "40px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "9pt", color: "#5b6b80", marginBottom: "4px" }}>Date</div>
                  <div style={{ borderBottom: "1px solid #001f3f", height: "24px" }} />
                </div>
              </div>
            </div>
          </section>
        </article>
      </main>

      <div className="screen-only">
        <Footer />
      </div>
    </div>
  );
}
