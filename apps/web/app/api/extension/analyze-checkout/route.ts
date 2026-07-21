import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import {
  getDomainCreatedDate,
  domainAgeDays,
  domainAgeBand,
} from "@askarthur/scam-engine/whois-cached";
import { scoreCheckoutGuard } from "@askarthur/scam-engine/checkout-guard-score";
import {
  lexicalMatch,
  brandNormalize,
  AU_BRAND_WATCHLIST,
} from "@askarthur/shopfront-glue";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { getLogger } from "@askarthur/utils/axiom-logger";
import type { DomainAgeBand } from "@askarthur/types";
import { logCost } from "@/lib/cost-telemetry";
import { validateExtensionRequest } from "../_lib/auth";

// PR-B1a — Checkout Guardrail server route. The extension content script (PR-B1b)
// fires this when it detects a checkout / payment form, so we can warn BEFORE the
// user submits card details on a lookalike storefront reached via a Google
// Shopping ad. LOW-LATENCY by design: lexical match + one scam_urls read +
// cache-first WHOIS age — no APIVoid / Claude on the hot path (that stays in the
// opt-in Deep Shop Check). Plan: docs/plans/checkout-guardrail-and-copytrading-defence.md.

const CheckoutSchema = z.object({
  url: z.string().url().max(2048),
  /** The brand name/text the page visually displays, for the brand-vs-domain
   *  mismatch signal (sent by the content script; optional). */
  brandOnPage: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Auth + per-install rate limit. The content script (PR-B1b) MUST send
    //    `x-scan-source: checkout` so auto-fired checkout scans use the dedicated
    //    checkout bucket (30/min, 300/day) and never eat the manual 50/day.
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && {
            headers: { "Retry-After": auth.retryAfter },
          }),
        },
      );
    }

    // 2. Server-side gate — dark by default. 503 (not 404) so the client can
    // tell "feature off" from "route missing" and stay silent.
    if (!featureFlags.checkoutGuard) {
      return NextResponse.json({ error: "not_enabled" }, { status: 503 });
    }

    // 3. Validate input.
    const body = await req.json();
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const norm = normalizeURL(parsed.data.url);
    if (!norm) {
      return NextResponse.json(
        { error: "validation_error", message: "Could not normalize URL" },
        { status: 400 },
      );
    }
    const domain = norm.domain;

    // 4a. Lexical lookalike of a watchlist brand (self-clones excluded inside
    //     lexicalMatch via the legitimate-domain set).
    const match = lexicalMatch(domain);
    const lexical = match
      ? { brand: match.brand, signalType: match.signal_type }
      : null;

    // 4b. Known scam URL — match the checkout page's FULL HOST (domain +
    //     subdomain), NOT the registrable domain. ~23% of active scam_urls rows
    //     live on shared hosts (myshopify.com, web.app, wixsite.com, square.site,
    //     …) or on legit brands (google.com, adobe.com, anz.co.nz) whose
    //     SUBDOMAINS host phishing — because normalizeURL collapses those to the
    //     bare registrable domain, a domain-level match would false-positive
    //     HIGH_RISK on a legit Shopify/Square/Wix checkout or a real bank page.
    //     A host-level match warns only on the actual scam host. www is folded
    //     to the bare host so 'www.x.com' and 'x.com' still match; typosquats of
    //     watchlist brands are covered by the lexical arm regardless.
    //     confidence_level is ignored — it is 'low' for ~all rows (bulk-feed
    //     default), so presence (not the meaningless tier) is the signal.
    let scamUrlListed = false;
    const supabase = createServiceClient();
    if (supabase) {
      const wantSub = norm.subdomain === "www" ? null : norm.subdomain;
      let q = supabase
        .from("scam_urls")
        .select("id")
        .eq("domain", domain)
        .eq("is_active", true);
      q = wantSub
        ? q.eq("subdomain", wantSub)
        : q.or("subdomain.is.null,subdomain.eq.,subdomain.eq.www");
      const { data } = await q.limit(1).maybeSingle();
      scamUrlListed = !!data;
    }

    // 4c. Domain registration age — assessed ONLY when the domain already looks
    //     suspicious (a lookalike or a threat-list hit) and is non-.au. A clean
    //     checkout needs no age signal (nothing else would fire), so we never
    //     spend the whoisjson quota (1k/mo; its cache write-back is UPDATE-only,
    //     so a first-seen legit domain never caches) on every checkout page load.
    //     .au registration dates are always withheld anyway, so skip those too.
    let ageBand: DomainAgeBand | null = null;
    const alreadySuspicious = lexical !== null || scamUrlListed;
    if (alreadySuspicious && !domain.endsWith(".au")) {
      const { createdDate } = await getDomainCreatedDate(domain);
      ageBand = domainAgeBand(domainAgeDays(createdDate));
    }

    // 4d. Brand-asset-vs-domain mismatch — the page claims a watchlist brand
    //     whose official domains don't include this domain.
    let brandOnPageMismatch = false;
    if (parsed.data.brandOnPage) {
      const claimed = brandNormalize(parsed.data.brandOnPage);
      if (claimed) {
        const entry = AU_BRAND_WATCHLIST.find(
          (e) =>
            brandNormalize(e.brand) === claimed ||
            (e.aliases ?? []).some((a) => brandNormalize(a) === claimed),
        );
        if (entry && !entry.legitimate_domains.includes(domain)) {
          brandOnPageMismatch = true;
        }
      }
    }

    // 5. Score.
    const scored = scoreCheckoutGuard({
      lexical,
      scamUrlListed,
      domainAgeBand: ageBand,
      brandOnPageMismatch,
    });

    // 6. Observability — free (no paid API); units-only so volume + verdict mix
    //    stay visible without exposing scanned content.
    logCost({
      feature: "checkout-guard",
      provider: "internal",
      operation: "score",
      units: 1,
      estimatedCostUsd: 0,
      metadata: {
        verdict: scored.verdict,
        has_lexical: !!lexical,
        age_band: ageBand,
      },
    });

    // A checkout page that scored a warning is a rare, high-value event — ship
    // it ALWAYS via the Axiom warn (bypasses the 10% info sample). Domain only,
    // never the scanned page content. No-op when FF_AXIOM_ENABLED is off.
    if (scored.verdict !== "SAFE") {
      const axiom = getLogger({
        source: "api/extension",
        requestId: req.headers.get("x-request-id") ?? undefined,
      });
      axiom.warn("checkout_guard_verdict", {
        verdict: scored.verdict,
        score: scored.score,
        domain,
        has_lexical: !!lexical,
        scam_url_listed: scamUrlListed,
        age_band: ageBand,
      });
      void axiom.flush().catch(() => {});
    }

    return NextResponse.json(
      {
        verdict: scored.verdict,
        score: scored.score,
        reasons: scored.reasons,
        domain,
      },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } },
    );
  } catch (err) {
    logger.error("Extension checkout-guard error", { error: String(err) });
    return NextResponse.json(
      {
        error: "check_failed",
        message: "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}
