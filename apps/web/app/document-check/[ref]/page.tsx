import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  DOCUMENT_CHECK_COPY,
  DOCUMENT_CHECK_DISCLAIMER,
  type DocumentAbnCheck,
  type DocumentFinding,
} from "@askarthur/types";
import { createServiceClient } from "@askarthur/supabase/server";
import { DOCUMENT_CHECK_REF_PATTERN } from "@/lib/check-ref";

export const metadata = {
  title: "Document Check Evidence — Ask Arthur",
  robots: { index: false, follow: false },
};

// Gate evaluates per-request, not at build (featureGate doctrine).
export const dynamic = "force-dynamic";

// Public evidence page, keyed on the unguessable DC- ref alone (ADR-0022:
// ~60 bits vs at most thousands of flagged, metadata-only records —
// enumeration is impractical). Gates on the RECORDS flag alone: B2B refs
// are minted while the consumer flag is dark, and a quoted evidence ref
// that 404s is indistinguishable from a fabricated one. 404s identically
// for a missing ref, a malformed ref, and flag-off. Renders the same named
// findings + asymmetry framing as the live checker — never a verdict.
// Marketing page shell + verdict tokens per DESIGN_SYSTEM.md.
export default async function DocumentCheckEvidencePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  if (!featureFlags.documentCheckRecords) {
    notFound();
  }

  const { ref } = await params;
  if (!DOCUMENT_CHECK_REF_PATTERN.test(ref)) notFound();

  const supabase = createServiceClient();
  if (!supabase) notFound();

  const { data: record } = await supabase
    .from("document_check_records")
    .select(
      "check_ref, checked_at, doc_sha256, jurisdiction, structural_summary, findings, abn_summary",
    )
    .eq("check_ref", ref)
    .maybeSingle();
  if (!record) notFound();

  const findings = (record.findings as DocumentFinding[] | null) ?? [];
  const abns = (record.abn_summary as DocumentAbnCheck[] | null) ?? [];
  const structural = record.structural_summary as {
    producer?: string | null;
    creator?: string | null;
    incrementalUpdates?: number;
    creationDate?: string | null;
    modDate?: string | null;
  } | null;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        <h1 className="text-deep-navy text-4xl font-extrabold mb-4 leading-tight text-center">
          Document Check Evidence
        </h1>
        <p className="text-lg text-gov-slate mb-2 leading-relaxed text-center">
          Reference{" "}
          <span className="font-mono text-base text-deep-navy">{record.check_ref}</span>
        </p>
        <p className="text-sm text-slate-500 mb-10 text-center">
          Recorded {new Date(record.checked_at as string).toLocaleString("en-AU")} —
          these are the structural signals read from the file at check time,
          not a verdict about the document.
        </p>

        <section className="bg-white border border-border-light rounded-xl shadow-sm p-6 space-y-4 text-sm">
          <ul className="space-y-3">
            {findings.map((f) => {
              const copy = DOCUMENT_CHECK_COPY[f.signal];
              if (!copy) return null;
              return (
                <li key={f.signal} className="rounded-xl border border-[#FFE082] bg-[#FFF8E1] p-4">
                  <p className="font-semibold text-[#E65100]">{copy.label}</p>
                  <p className="mt-1 leading-relaxed text-gov-slate">{copy.explain}</p>
                </li>
              );
            })}
          </ul>

          {abns.length > 0 ? (
            <div className="rounded-xl border border-border-light p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-deep-navy">
                ABNs on the document at check time
              </p>
              <ul className="mt-2 space-y-1.5">
                {abns.map((a) => (
                  <li key={a.abn} className="flex justify-between gap-4">
                    <span className="font-mono text-xs text-gov-slate">{a.abn}</span>
                    <span
                      className={
                        a.status === "registered" || a.status === "unverified"
                          ? "text-right text-gov-slate"
                          : "text-right font-medium text-[#F57C00]"
                      }
                    >
                      {a.status === "registered"
                        ? `registered${a.entityName ? ` — ${a.entityName}` : ""}`
                        : a.status === "cancelled"
                          ? `cancelled on the register${a.entityName ? ` — ${a.entityName}` : ""}`
                          : a.status === "not_registered"
                            ? "not on the ABR register"
                            : a.status === "invalid_checksum"
                              ? "not a possible ABN"
                              : "could not be checked"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <dl className="space-y-2">
            {structural?.producer ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Produced by</dt>
                <dd className="text-right text-gov-slate">{structural.producer}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-slate-500">Document SHA-256</dt>
              <dd className="break-all font-mono text-xs text-slate-500">
                {record.doc_sha256}
              </dd>
            </div>
          </dl>

          <p className="text-xs leading-relaxed text-slate-500">
            {DOCUMENT_CHECK_DISCLAIMER}
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
