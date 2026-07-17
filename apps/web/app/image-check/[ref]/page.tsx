import { notFound } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import { CHECK_REF_PATTERN } from "@/lib/check-ref";
import {
  REPORTCYBER_URL,
  ESAFETY_REPORT_URL,
} from "@/lib/onward/destinations";

export const metadata = {
  title: "Image Check Evidence — Ask Arthur",
  robots: { index: false, follow: false },
};

// Public evidence page, keyed on the unguessable check ref alone (ADR-0022:
// ~60 bits vs at most thousands of flagged, metadata-only, non-PII records —
// enumeration is impractical). 404s identically for a missing ref, a
// malformed ref, and flag-off, so the page leaks nothing about which refs
// exist while dark.
export default async function ImageCheckEvidencePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  if (!featureFlags.imageCheck || !featureFlags.imageCheckRecords) {
    notFound();
  }

  const { ref } = await params;
  if (!CHECK_REF_PATTERN.test(ref)) notFound();

  const supabase = createServiceClient();
  if (!supabase) notFound();

  const { data: record } = await supabase
    .from("image_check_records")
    .select(
      "check_ref, checked_at, image_url, page_url, image_sha256, ai_confidence, deepfake_confidence, generator_source, generator_breakdown, content_credentials, vision_summary, impersonated_brand, impersonated_celebrity",
    )
    .eq("check_ref", ref)
    .maybeSingle();
  if (!record) notFound();

  const pct = (v: number | null): string =>
    v === null || v === undefined ? "not assessed" : `${Math.round(Number(v) * 100)}%`;
  const breakdown =
    (record.generator_breakdown as Array<{ class: string; score: number }> | null) ?? null;
  const cc = record.content_credentials as { present: boolean; format?: string } | null;

  return (
    <main className="min-h-screen bg-[#fbfbfa] px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Ask Arthur — Image Check Evidence
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Reference {record.check_ref}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Checked {new Date(record.checked_at as string).toUTCString()}
          </p>
        </header>

        <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Checked item</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Image URL</dt>
              <dd className="break-all font-mono text-xs text-gray-800">
                {record.image_url ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Found on page</dt>
              <dd className="break-all font-mono text-xs text-gray-800">
                {record.page_url ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Image SHA-256</dt>
              <dd className="break-all font-mono text-xs text-gray-800">
                {record.image_sha256 ??
                  "not captured (image bytes were unavailable at check time)"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-gray-500">
            Ask Arthur does not retain the image itself. The SHA-256 lets
            anyone holding a copy verify it is the file that was assessed.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Detection results (probabilistic)
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">AI-generation score</dt>
              <dd className="font-medium text-gray-900">
                {pct(record.ai_confidence as number | null)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Deepfake score</dt>
              <dd className="font-medium text-gray-900">
                {pct(record.deepfake_confidence as number | null)}
              </dd>
            </div>
            {breakdown && breakdown.length > 0 && (
              <div>
                <dt className="text-gray-500">Generator attribution</dt>
                <dd className="text-gray-800">
                  {breakdown
                    .map((g) => `${g.class} (${Math.round(g.score * 100)}%)`)
                    .join(", ")}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Content Credentials (C2PA)</dt>
              <dd className="text-gray-800">
                {cc === null
                  ? "not assessed (image bytes unavailable)"
                  : cc.present
                    ? `manifest present in ${cc.format ?? "image"} container (issuer not cryptographically verified)`
                    : "no manifest detected"}
              </dd>
            </div>
          </dl>
          {record.vision_summary ? (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              {record.vision_summary as string}
              {record.impersonated_celebrity ? (
                <p className="mt-1 text-xs text-gray-500">
                  Monitored-person match: {record.impersonated_celebrity as string}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-gray-500">
            Automated classifier scores are probabilistic signals, not a
            forensic certification.
          </p>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Using this as evidence
          </h2>
          <a
            href={`/api/image-check/${encodeURIComponent(record.check_ref as string)}/pdf`}
            className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Download evidence PDF
          </a>
          <p className="text-sm text-gray-700">Where to send it:</p>
          <ul className="list-inside list-disc text-sm text-gray-700">
            <li>
              <a className="underline" href={REPORTCYBER_URL} target="_blank" rel="noopener noreferrer">
                ReportCyber
              </a>{" "}
              — the official police channel; gives you a reference number and
              routes to the right state police.
            </li>
            <li>
              <a className="underline" href={ESAFETY_REPORT_URL} target="_blank" rel="noopener noreferrer">
                eSafety Commissioner
              </a>{" "}
              — for image-based abuse or harmful content involving a person.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
