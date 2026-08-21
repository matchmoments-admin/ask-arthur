import { notFound } from "next/navigation";
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
// enumeration is impractical). 404s identically for a missing ref, a
// malformed ref, and flag-off, so the page leaks nothing about which refs
// exist while dark. Renders the same named findings + asymmetry framing as
// the live checker — never a verdict.
export default async function DocumentCheckEvidencePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  // Gate on the RECORDS flag alone: B2B DC- refs are minted under
  // documentCheckV1Api + documentCheckRecords with the consumer flag still
  // dark, and a quoted evidence ref that 404s is indistinguishable from a
  // fabricated one. The unguessable ref is the access control (ADR-0022).
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
    <main className="min-h-screen bg-[#fbfbfa] px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Ask Arthur — Document Check Evidence
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Check reference {record.check_ref}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Recorded {new Date(record.checked_at as string).toLocaleString("en-AU")}. This
            page shows the structural signals read from the file at check
            time — it is not a verdict about the document.
          </p>
        </header>

        <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3 text-sm">
          <ul className="space-y-3">
            {findings.map((f) => {
              const copy = DOCUMENT_CHECK_COPY[f.signal];
              if (!copy) return null;
              return (
                <li key={f.signal} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-medium text-gray-900">{copy.label}</p>
                  <p className="mt-1 text-gray-700">{copy.explain}</p>
                </li>
              );
            })}
          </ul>

          {abns.length > 0 ? (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">ABNs on the document at check time</p>
              <ul className="mt-1 space-y-1">
                {abns.map((a) => (
                  <li key={a.abn} className="flex justify-between gap-4">
                    <span className="font-mono text-xs text-gray-700">{a.abn}</span>
                    <span className="text-right text-gray-800">
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
                <dt className="text-gray-500">Produced by</dt>
                <dd className="text-right text-gray-800">{structural.producer}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-gray-500">Document SHA-256</dt>
              <dd className="break-all font-mono text-xs text-gray-700">
                {record.doc_sha256}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-gray-500">{DOCUMENT_CHECK_DISCLAIMER}</p>
        </section>
      </div>
    </main>
  );
}
