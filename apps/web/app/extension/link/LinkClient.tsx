"use client";

import { useEffect, useState } from "react";

type LinkState =
  | { phase: "no-token" }
  | { phase: "linking" }
  | { phase: "linked"; tier: string; installId: string }
  | { phase: "error"; message: string };

// Consumes the single-use link token on mount, then offers the Extension Pro
// checkout for linked free-tier installs. The token arrives via the URL the
// extension opened; a missing token means the user navigated here directly.
export function LinkClient({
  token,
  userEmail,
  checkoutSuccess,
}: {
  token: string | null;
  userEmail: string;
  checkoutSuccess: boolean;
}) {
  const [state, setState] = useState<LinkState>(
    token ? { phase: "linking" } : { phase: "no-token" },
  );
  const [checkoutBusy, setCheckoutBusy] = useState<"monthly" | "annual" | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/extension/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.linked) {
          setState({
            phase: "linked",
            tier: json.tier ?? "free",
            installId: json.installId,
          });
        } else {
          setState({
            phase: "error",
            message:
              json.message ??
              "Something went wrong linking your extension. Try again from the extension's More tab.",
          });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: "error", message: "Network error — please try again." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function startCheckout(installId: string, interval: "monthly" | "annual") {
    setCheckoutBusy(interval);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/extension/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installId, interval }),
      });
      const json = await res.json();
      if (res.ok && json.url) {
        window.location.assign(json.url);
        return;
      }
      setCheckoutError(json.message ?? "Couldn't start checkout — try again.");
    } catch {
      setCheckoutError("Network error — please try again.");
    } finally {
      setCheckoutBusy(null);
    }
  }

  if (checkoutSuccess) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 space-y-2">
        <p className="text-sm font-medium text-green-900">
          Welcome to Ask Arthur Pro 🎉
        </p>
        <p className="text-sm text-green-800">
          Your extension picks up the new limits within an hour (or immediately
          after reopening the popup). You can manage the subscription any time
          from your account&apos;s billing page.
        </p>
      </div>
    );
  }

  if (state.phase === "no-token") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-700">
          To link your extension, open the Ask Arthur extension, go to{" "}
          <span className="font-medium">More → Link account</span>, and follow
          the link it opens. Link buttons expire after 10 minutes.
        </p>
      </div>
    );
  }

  if (state.phase === "linking") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-700">Linking your extension…</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-800">{state.message}</p>
      </div>
    );
  }

  const isPro = state.tier === "pro";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-2">
        <p className="text-sm text-gray-900 font-medium">
          Extension linked to {userEmail}
        </p>
        <p className="text-sm text-gray-600">
          Current plan:{" "}
          <span className="font-medium capitalize">{state.tier}</span>
        </p>
      </div>

      {!isPro && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Ask Arthur Extension Pro
            </p>
            <ul className="mt-2 text-sm text-gray-700 list-disc list-inside space-y-1">
              <li>500 checks per day (free: 50)</li>
              <li>30 image checks per day (free: 3)</li>
              <li>Real-time URL Guard + email scanning as they roll out</li>
            </ul>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={checkoutBusy !== null}
              onClick={() => startCheckout(state.installId, "monthly")}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
            >
              {checkoutBusy === "monthly" ? "Opening…" : "A$4.99 / month"}
            </button>
            <button
              type="button"
              disabled={checkoutBusy !== null}
              onClick={() => startCheckout(state.installId, "annual")}
              className="rounded-lg border border-gray-900 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-60"
            >
              {checkoutBusy === "annual" ? "Opening…" : "A$49 / year"}
            </button>
          </div>
          {checkoutError && <p className="text-sm text-red-700">{checkoutError}</p>}
          <p className="text-xs text-gray-500">
            Prices in AUD, GST inclusive. Cancel any time.
          </p>
        </div>
      )}
    </div>
  );
}
