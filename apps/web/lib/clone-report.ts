// Share-by-token lookup for the public Brand Stewardship clone-watch report
// page (/clone-report/[token]). Mirrors lib/scan.ts: the React.cache wrap lives
// at the definition site so generateMetadata + the page share one DB read per
// request.
//
// Reads via the service client by the random share_token (v181). Only the
// non-sensitive presentation fields are selected — never recipient_email or
// other brands' rows. The token is the capability; an unguessable UUID that
// only the brand's emailed recipient holds.

import "server-only";

import { cache } from "react";
import { createServiceClient } from "@askarthur/supabase/server";
import { cloneDetectionsFromMetrics } from "@/lib/email/brand-stewardship-clone-detections";
import type { CloneDetections } from "@/emails/BrandStewardshipReport";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CloneReportView {
  brandName: string;
  /** YYYY-MM-01 */
  periodMonth: string;
  /** "May 2026" */
  periodLabel: string;
  clones: CloneDetections;
}

interface StewardshipMetrics {
  clones?: unknown;
}

function periodLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const getCloneReportByToken = cache(
  async (token: string): Promise<CloneReportView | null> => {
    if (!UUID_RE.test(token)) return null;
    const sb = createServiceClient();
    if (!sb) return null;

    const { data, error } = await sb
      .from("brand_stewardship_reports")
      .select("brand_name, period_month, metrics")
      .eq("share_token", token)
      .single();
    if (error || !data) return null;

    const clones = cloneDetectionsFromMetrics(
      (data.metrics as StewardshipMetrics | null)?.clones,
    );
    // The share page is the clone-watch breakdown view — if a report carries no
    // clone detections there's nothing to render.
    if (!clones) return null;

    const periodMonth = String(data.period_month).slice(0, 10);
    return {
      brandName: data.brand_name as string,
      periodMonth,
      periodLabel: periodLabel(periodMonth),
      clones,
    };
  },
);
