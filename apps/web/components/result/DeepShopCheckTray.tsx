"use client";

// Deep Shop Check tray — Shop Signal Stage 1.
//
// A distinct panel below the Stage-0 commerce-flag chips. The user clicks
// "Run a deeper shop check" → POST /api/shop-check → poll
// GET /api/shop-check/[id] → render the ABN / domain-age / reputation
// breakdown. Deliberately separate from the analyze verdict above — the
// deep check is its own read, not a re-verdict.
//
// See docs/adr/0008-shop-signal-deep-check-user-initiated.md.

import { useState, useRef, useEffect } from "react";
import { usePlausible } from "next-plausible";
import {
  Building2,
  CalendarClock,
  Loader2,
  MessageSquare,
  Search,
  ShieldQuestion,
  Store,
} from "lucide-react";
import type {
  ShopSignal,
  ShopCheckResult,
  ShopCheckBand,
} from "@askarthur/types";

interface DeepShopCheckTrayProps {
  /** The commerce URL to deep-check (already extracted by the caller). */
  commerceUrl: string;
  /** Stage-0 signal — carries commerceFlags + referrerSource for the POST. */
  shopSignal: ShopSignal;
}

type TrayState = "idle" | "loading" | "complete" | "error";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // ~60s ceiling before a soft timeout

const BAND_STYLE: Record<
  ShopCheckBand,
  { label: string; className: string }
> = {
  "low-concern": {
    label: "Low concern",
    className: "bg-warn-bg/40 border-warn-border/70 text-warn-text",
  },
  "some-concern": {
    label: "Some concern",
    className: "bg-warn-bg border-warn-border text-warn-heading",
  },
  "high-concern": {
    label: "High concern",
    className: "bg-danger-bg border-danger-border text-danger-text",
  },
};

function domainAgeLabel(domainAge: ShopCheckResult["domainAge"]): string {
  if (!domainAge || domainAge.band === "unknown") {
    return "Registration date unavailable";
  }
  const days = domainAge.ageDays;
  if (days === null) return "Registration date unavailable";
  if (domainAge.band === "fresh") {
    return `Registered very recently — ${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (domainAge.band === "recent") {
    return `Registered ${days} days ago — still a new domain`;
  }
  const years = Math.floor(days / 365);
  return years >= 1
    ? `Established domain — registered about ${years} year${years === 1 ? "" : "s"} ago`
    : `Established domain — registered ${days} days ago`;
}

function abnLabel(abn: ShopCheckResult["abn"]): string {
  if (!abn) return "ABN not checked";
  switch (abn.status) {
    case "verified":
      return abn.entityName
        ? `ABN verified — registered to ${abn.entityName}`
        : "ABN verified on the ABR register";
    case "name-mismatch":
      return abn.entityName
        ? `ABN is registered to "${abn.entityName}" — which doesn't match this store`
        : "The displayed ABN is registered to a different business";
    case "unregistered":
      return "An ABN is displayed but it isn't on the ABR register";
    case "no-abn":
      return "No ABN displayed — required for a legitimate Australian store";
    case "unverified":
      return "We couldn't verify the ABN — the register or the page was unavailable. Try the check again shortly";
    case "not-applicable":
      return "ABN check not applicable — this isn't an Australian (.au) store";
  }
}

function reputationLabel(
  verdict: ShopCheckResult["paidProviderVerdict"],
): string {
  if (!verdict) return "Site-reputation feed unavailable for this check";
  switch (verdict.verdict) {
    case "risky":
      return "Flagged as risky by the site-reputation feed";
    case "suspicious":
      return "Treated with caution by the site-reputation feed";
    case "safe":
      return "No reputation flags on the site-reputation feed";
  }
}

function reviewsLabel(reviews: ShopCheckResult["reviews"]): string {
  if (!reviews) return "On-page reviews weren't available to check";
  const count = reviews.totalReviews;
  const avg = reviews.averageRating;
  const stats =
    count !== null && avg !== null
      ? `${count.toLocaleString()} reviews at ${avg}★`
      : count !== null
        ? `${count.toLocaleString()} reviews`
        : "the on-page reviews";
  switch (reviews.verdict) {
    case "manipulated":
      return `${stats} — the rating pattern looks unusual (e.g. an implausibly thin low-star tail), a common sign of seeded reviews`;
    case "suspicious":
      return `${stats} — some aspects of the rating pattern are worth a second look`;
    case "clean":
      return `${stats} — the review pattern looks normal`;
  }
}

export default function DeepShopCheckTray({
  commerceUrl,
  shopSignal,
}: DeepShopCheckTrayProps) {
  const [state, setState] = useState<TrayState>("idle");
  const [result, setResult] = useState<ShopCheckResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const plausible = usePlausible();

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Clear any in-flight poll on unmount.
  useEffect(() => stopPolling, []);

  function startPolling(id: string) {
    let polls = 0;
    pollRef.current = setInterval(async () => {
      polls += 1;
      if (polls > MAX_POLLS) {
        stopPolling();
        setState("error");
        return;
      }
      try {
        const res = await fetch(`/api/shop-check/${id}`);
        if (!res.ok) return; // transient — keep polling
        const data = (await res.json()) as ShopCheckResult;
        if (data.status === "complete") {
          stopPolling();
          setResult(data);
          setState("complete");
          plausible("shop_check_completed", {
            props: { band: data.band ?? "unknown" },
          });
        } else if (data.status === "error") {
          stopPolling();
          setState("error");
        }
        // queued / processing → keep polling
      } catch {
        // transient network error — keep polling until the cap
      }
    }, POLL_INTERVAL_MS);
  }

  async function runCheck() {
    setState("loading");
    plausible("shop_check_requested");
    try {
      const res = await fetch("/api/shop-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: commerceUrl,
          commerceFlags: shopSignal.commerceFlags,
          ...(shopSignal.referrerSource && {
            referrerSource: shopSignal.referrerSource,
          }),
        }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const { id } = (await res.json()) as { id: string };
      if (!id) {
        setState("error");
        return;
      }
      startPolling(id);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-4">
      <div className="flex items-center gap-2">
        <Store size={18} className="text-deep-navy shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-bold text-deep-navy">Deep shop check</h3>
      </div>

      {state === "idle" && (
        <>
          <p className="mt-1.5 text-sm text-gov-slate leading-relaxed">
            Run a deeper check on this store — we verify the business&rsquo;s
            ABN against the national register, check how new the domain is,
            and run a site-reputation feed.
          </p>
          <button
            type="button"
            onClick={runCheck}
            className="mt-3 h-10 px-5 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-xs"
          >
            Run a deeper shop check
          </button>
        </>
      )}

      {state === "loading" && (
        <div className="mt-3 flex items-center gap-3">
          <Loader2
            size={18}
            className="text-deep-navy animate-spin shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm text-gov-slate">
            Checking the store — ABN register, domain age, reputation feed…
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-3">
          <p className="text-sm text-gov-slate">
            We couldn&rsquo;t complete the deep check. Please try again shortly.
          </p>
          <button
            type="button"
            onClick={runCheck}
            className="mt-3 h-10 px-5 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-xs"
          >
            Try again
          </button>
        </div>
      )}

      {state === "complete" && result && (
        <div className="mt-3 space-y-3">
          {result.band && (
            <span
              className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${BAND_STYLE[result.band].className}`}
            >
              {BAND_STYLE[result.band].label}
            </span>
          )}

          <ul className="space-y-2.5">
            <li className="flex gap-2.5">
              <CalendarClock
                size={16}
                className="text-gov-slate shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                  Domain age
                </p>
                <p className="text-sm text-deep-navy leading-snug">
                  {domainAgeLabel(result.domainAge)}
                </p>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Building2
                size={16}
                className="text-gov-slate shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                  Business registration (ABN)
                </p>
                <p className="text-sm text-deep-navy leading-snug">
                  {abnLabel(result.abn)}
                </p>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Search
                size={16}
                className="text-gov-slate shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                  Site reputation
                </p>
                <p className="text-sm text-deep-navy leading-snug">
                  {reputationLabel(result.paidProviderVerdict)}
                </p>
              </div>
            </li>
            {result.reviews && (
              <li className="flex gap-2.5">
                <MessageSquare
                  size={16}
                  className="text-gov-slate shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                    Customer reviews
                  </p>
                  <p className="text-sm text-deep-navy leading-snug">
                    {reviewsLabel(result.reviews)}
                  </p>
                </div>
              </li>
            )}
          </ul>

          <p className="flex gap-1.5 text-xs text-gov-slate leading-relaxed pt-1">
            <ShieldQuestion size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              This deep check is a heuristic aid, separate from the verdict
              above. A clean result is not a guarantee — always pay with a
              method that offers buyer protection.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
