// GET /api/mobile/regulator-alerts — last 10 narrative items from the
// Scamwatch / ACSC / ASIC pipeline, shaped for direct consumption by the
// mobile app's RegulatorAlertsScreen.
//
// Sibling endpoint to /api/mobile/threat-snapshot — deliberately a NEW
// route rather than extending threat-snapshot's compact shape (which is
// already cached 24h and consumed by the offline DB sync). Mixing two
// payloads would force a breaking change on the offline path.
//
// Cache-Control: 30 min — narratives update infrequently, but faster than
// threat-snapshot's daily refresh because regulator alerts are time-sensitive.

import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type {
  RegulatorAlert,
  RegulatorSource,
  RegulatorSourceLabel,
} from "@askarthur/types";

const SOURCE_LABEL: Record<RegulatorSource, RegulatorSourceLabel> = {
  scamwatch_alert: "ACCC Scamwatch",
  acsc: "ASD ACSC",
  asic_investor: "ASIC",
};

const LIMIT = 10;
const SUMMARY_MAX_CHARS = 280;

function buildSummary(
  description: string | null,
  body: string | null,
): string | null {
  const raw = description ?? body;
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= SUMMARY_MAX_CHARS) return cleaned;
  return cleaned.slice(0, SUMMARY_MAX_CHARS).trimEnd() + "…";
}

export async function GET() {
  if (!featureFlags.mobileRegulatorAlerts) {
    return NextResponse.json(
      { error: "Endpoint not enabled on this deployment" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json([], {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  const { data, error } = await supabase
    .from("feed_items")
    .select("id, source, title, description, body_md, url, category, impersonated_brand, published_at")
    .in("source", ["scamwatch_alert", "acsc", "asic_investor"])
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (error) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const alerts: RegulatorAlert[] = (data ?? []).map((row) => {
    const source = row.source as RegulatorSource;
    return {
      id: row.id as number,
      source,
      sourceLabel: SOURCE_LABEL[source] ?? source,
      title: (row.title as string) ?? "",
      summary: buildSummary(
        row.description as string | null,
        row.body_md as string | null,
      ),
      url: (row.url as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      impersonatedBrand: (row.impersonated_brand as string | null) ?? null,
      publishedAt: (row.published_at as string | null) ?? null,
    };
  });

  return NextResponse.json(alerts, {
    headers: {
      "Cache-Control": "public, max-age=1800, s-maxage=1800",
    },
  });
}
