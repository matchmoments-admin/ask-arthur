import { requireAdmin } from "@/lib/adminAuth";
import ShowcaseClient from "./ShowcaseClient";
import { LAST_UPDATED } from "./showcase-data";

export const dynamic = "force-dynamic";

// Portfolio walk-through page: fully static by design. All content lives in
// showcase-data.ts — this page makes zero DB reads and zero fetches, ever.
export default async function ShowcasePage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 lg:px-6 lg:py-8">
      <div className="mb-[26px] flex flex-col gap-[10px]">
        <h1 className="serif" style={{ fontSize: 28, lineHeight: 1.15, color: "var(--color-ink)" }}>
          Ask Arthur — system showcase
        </h1>
        <p
          className="max-w-[720px]"
          style={{ fontSize: 13.5, color: "var(--color-muted)", lineHeight: 1.5 }}
        >
          Every integration, background worker and data flow on the platform, on one screen. Click
          a node to inspect its features, tech stack and engineering notes.
        </p>
        <div className="mt-[2px] flex flex-wrap gap-2">
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--color-teal)",
              background: "var(--color-teal-soft)",
              border: "1px solid #d0e9e6",
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            FULLY STATIC · ZERO DB READS
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            showcase-data.ts
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            UPDATED {LAST_UPDATED}
          </span>
        </div>
      </div>
      <ShowcaseClient />
    </div>
  );
}
