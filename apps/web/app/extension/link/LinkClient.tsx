"use client";

import { useEffect, useState } from "react";

type LinkState =
  | { phase: "no-token" }
  | { phase: "linking" }
  | { phase: "linked"; tier: string }
  | { phase: "error"; message: string };

// Consumes the single-use link token on mount. The token arrives via the URL
// the extension opened; a missing token means the user navigated here
// directly — tell them where the button lives instead of erroring.
export function LinkClient({
  token,
  userEmail,
}: {
  token: string | null;
  userEmail: string;
}) {
  const [state, setState] = useState<LinkState>(
    token ? { phase: "linking" } : { phase: "no-token" },
  );

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
          setState({ phase: "linked", tier: json.tier ?? "free" });
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
          setState({
            phase: "error",
            message: "Network error — please try again.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
      <p className="text-sm text-gray-900 font-medium">
        Extension linked to {userEmail}
      </p>
      <p className="text-sm text-gray-600">
        Current plan: <span className="font-medium capitalize">{state.tier}</span>
      </p>
      <p className="text-xs text-gray-500">
        Ask Arthur Pro (more checks per day, image checking headroom) is coming
        to this page soon.
      </p>
    </div>
  );
}
