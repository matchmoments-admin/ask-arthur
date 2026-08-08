// Feed controls for /admin/health (#952): mute / unmute / disable / enable a
// threat feed, and dispatch a one-shot scrape probe.
//
// Before this, every one of these was raw SQL or a `gh workflow run` — so a
// dark feed (acsc: enabled=false, no expiry) stayed dark unnoticed. Writes are
// narrow by design: only the four control columns on feed_sources, one slug
// per request, no bulk path.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { dispatchTargetFor } from "@/lib/dashboard/feed-controls";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";

const Body = z.object({
  slug: z.string().trim().min(1).max(80),
  action: z.enum(["mute", "unmute", "disable", "enable", "probe"]),
  /** mute only: how long, capped so a mute can't be forgotten forever. */
  days: z.number().int().min(1).max(90).optional(),
  /** mute/disable only: why — recorded so the next reader isn't guessing. */
  reason: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { slug, action, days, reason } = parsed.data;

  if (action === "probe") {
    const target = dispatchTargetFor(slug);
    if (!target) {
      return NextResponse.json({ error: "no_dispatch_target" }, { status: 400 });
    }
    const token = readStringEnv("GITHUB_TOKEN");
    if (!token) {
      return NextResponse.json({ error: "github_token_missing" }, { status: 503 });
    }
    const res = await fetch(
      "https://api.github.com/repos/matchmoments-admin/ask-arthur/actions/workflows/scrape-feeds.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { feed: target } }),
      },
    );
    if (res.status !== 204) {
      const detail = await res.text().catch(() => "");
      // A 403 here almost certainly means GITHUB_TOKEN lacks `actions:write`
      // (it was added for billing reads) — surface that rather than a blank
      // failure, and the UI falls back to the copyable gh command.
      logger.warn("feed_probe_dispatch_failed", { slug, target, status: res.status });
      return NextResponse.json(
        { error: "dispatch_failed", status: res.status, detail: detail.slice(0, 200) },
        { status: 502 },
      );
    }
    logger.warn("feed_probe_dispatched", { slug, target });
    return NextResponse.json({ ok: true, dispatched: target });
  }

  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  const patch: Record<string, unknown> = {};
  if (action === "mute") {
    patch.muted_until = new Date(Date.now() + (days ?? 14) * 86400_000).toISOString();
    patch.muted_reason = reason || "muted from /admin/health";
  } else if (action === "unmute") {
    patch.muted_until = null;
    patch.muted_reason = null;
  } else if (action === "disable") {
    // Indefinite by nature — that is the point of this action — but the reason
    // is REQUIRED so the next reader isn't left guessing why alerts are off,
    // which is precisely how acsc's silence became a mystery.
    if (!reason) {
      return NextResponse.json({ error: "reason_required_to_silence" }, { status: 400 });
    }
    patch.enabled = false;
    patch.muted_reason = reason;
  } else {
    // Resuming clears BOTH silencing mechanisms and the stale reason, so the
    // panel can't render an old explanation as if it were current.
    patch.enabled = true;
    patch.muted_until = null;
    patch.muted_reason = null;
  }

  const { data, error } = await sb
    .from("feed_sources")
    .update(patch)
    .eq("slug", slug)
    .select("slug, enabled, muted_until, muted_reason")
    .maybeSingle();

  if (error) {
    logger.error("feed_control_failed", { slug, action, error: error.message });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "unknown_feed" }, { status: 404 });

  // warn, not info: a feed going dark (or coming back) is a rare, high-value
  // fleet change that must always reach Axiom, never be sampled away.
  logger.warn("feed_control_changed", { slug, action, days, reason: reason || null });
  return NextResponse.json({ ok: true, feed: data });
}
