// /app/phone-footprint/monitors — saved-numbers dashboard.
//
// Server component — fetches the user's monitors via the monitors API
// (or directly through service client; we go direct here to avoid the
// internal HTTP roundtrip and let RSC stream). Lists each monitor with
// its latest score + last-refresh + alert count. Add-monitor flow is a
// client child that walks the OTP → create sequence.

import { notFound, redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { MonitorsClient } from "./MonitorsClient";

export const dynamic = "force-dynamic";

interface MonitorRow {
  id: number;
  msisdn_e164: string;
  alias: string | null;
  refresh_cadence: string;
  alert_threshold: number;
  last_refreshed_at: string | null;
  next_refresh_at: string;
  status: string;
  created_at: string;
  last_footprint_id: number | null;
}

interface FootprintMini {
  id: number;
  composite_score: number;
  band: string;
  generated_at: string;
}

export default async function MonitorsPage() {
  if (!featureFlags.phoneFootprintConsumer) notFound();
  const user = await requireAuth();

  const supa = createServiceClient();
  if (!supa) redirect("/login");

  const { data: monitors } = await supa
    .from("phone_footprint_monitors")
    .select(
      "id, msisdn_e164, alias, refresh_cadence, alert_threshold, last_refreshed_at, next_refresh_at, status, created_at, last_footprint_id",
    )
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .order("created_at", { ascending: false });

  const rows: MonitorRow[] = (monitors ?? []) as MonitorRow[];

  // Batch-fetch latest footprints + alert counts for the visible monitors.
  // Avoids N round-trips at scale; cheap because lists are small (<= 25
  // for Family tier, fewer for Personal).
  const footprintIds = rows
    .map((m) => m.last_footprint_id)
    .filter((x): x is number => x !== null);
  const monitorIds = rows.map((m) => m.id);

  let footprintsById = new Map<number, FootprintMini>();
  let alertCounts = new Map<number, number>();
  if (footprintIds.length > 0) {
    const { data: fps } = await supa
      .from("phone_footprints")
      .select("id, composite_score, band, generated_at")
      .in("id", footprintIds);
    footprintsById = new Map((fps ?? []).map((f) => [f.id, f as FootprintMini]));
  }
  if (monitorIds.length > 0) {
    // Count last-30-day alerts per monitor.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: alerts } = await supa
      .from("phone_footprint_alerts")
      .select("monitor_id")
      .in("monitor_id", monitorIds)
      .gte("created_at", since);
    for (const a of alerts ?? []) {
      const m = a.monitor_id as number;
      alertCounts.set(m, (alertCounts.get(m) ?? 0) + 1);
    }
  }

  // Pull entitlement for the header (saved_numbers_limit + cadence).
  const { data: entitlement } = await supa
    .from("phone_footprint_entitlements")
    .select("sku, saved_numbers_limit, refresh_cadence_min, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const enriched = rows.map((m) => ({
    ...m,
    latest_footprint: m.last_footprint_id
      ? footprintsById.get(m.last_footprint_id) ?? null
      : null,
    alerts_30d: alertCounts.get(m.id) ?? 0,
  }));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wider uppercase text-gray-500">
            Phone Footprint
          </p>
          <h1 className="font-serif text-2xl text-gray-900">Saved numbers</h1>
          <p className="mt-1 text-sm text-gray-600">
            We refresh each saved number on its cadence, compare against the
            previous snapshot, and alert you on any meaningful change.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div>
            {enriched.length} of {entitlement?.saved_numbers_limit ?? 1} saved
          </div>
          <div className="mt-1">
            Plan:{" "}
            <span className="font-medium text-gray-700">
              {entitlement?.sku ?? "Free"}
            </span>
          </div>
        </div>
      </header>

      <MonitorsClient
        monitors={enriched}
        savedNumbersLimit={entitlement?.saved_numbers_limit ?? 1}
        refreshCadenceMin={
          (entitlement?.refresh_cadence_min as "daily" | "weekly" | "monthly") ?? "monthly"
        }
      />
    </main>
  );
}
