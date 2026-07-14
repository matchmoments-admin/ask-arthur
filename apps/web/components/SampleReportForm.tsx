"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, CheckCircle2 } from "lucide-react";
import FeatureCard from "@/components/FeatureCard";

// "Email me a sample clone-watch report" — lets a prospective brand/partner
// see exactly what an Ask Arthur clone-watch alert looks like, with the full
// evidence pack, without an account. POSTs to /api/clone-watch/sample-report
// (Turnstile-verified + rate-limited).

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}
// Access window.turnstile via a local cast rather than augmenting the global
// Window type (another page already declares a differently-typed turnstile).
function getTurnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

type State = "idle" | "sending" | "done" | "error";

export default function SampleReportForm() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    const renderWidget = () => {
      if (renderedRef.current || !getTurnstile() || !widgetRef.current) return;
      renderedRef.current = true;
      getTurnstile()!.render(widgetRef.current, {
        sitekey: SITE_KEY,
        theme: "light",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    };
    const tsApi = getTurnstile();
    if (tsApi) {
      renderWidget();
    } else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      s.onload = renderWidget;
      document.head.appendChild(s);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setState("error");
      setMsg("Please complete the verification check.");
      return;
    }
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/clone-watch/sample-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: token }),
      });
      const data: { message?: string } = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("done");
        setMsg("Sent — check your inbox for the sample report.");
      } else {
        setState("error");
        setMsg(data.message || "Couldn't send right now. Please try again.");
        getTurnstile()?.reset();
        setToken("");
      }
    } catch {
      setState("error");
      setMsg("Network error — please try again.");
    }
  }

  if (state === "done") {
    return (
      <FeatureCard
        icon={CheckCircle2}
        iconClassName="text-emerald-600"
        title="Sample report on its way"
        titleAs="h3"
        description={`${msg} It shows the exact evidence pack a brand receives — clone domain, AI confidence, hosting attribution and takedown status.`}
      />
    );
  }

  return (
    <FeatureCard
      icon={FileText}
      title="See a sample report"
      titleAs="h3"
      description="See exactly what an Ask Arthur clone-watch alert looks like — the clone domain, AI confidence, hosting attribution and takedown status. We only use your email to send this one sample."
    >
      <form onSubmit={onSubmit} className="mt-4 flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourbrand.com.au"
          className="flex-1 rounded-lg border border-deep-navy/20 px-4 py-2.5 text-base text-deep-navy outline-none focus:border-deep-navy"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-lg bg-deep-navy px-5 py-2.5 text-base font-semibold text-white disabled:opacity-60 hover:bg-deep-navy/90 transition-colors"
        >
          {state === "sending" ? "Sending…" : "Email me a sample"}
        </button>
      </form>
      <div ref={widgetRef} className="mt-3" />
      {state === "error" && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      <p className="mt-3 text-xs text-slate-400">
        Verified by Cloudflare Turnstile.
      </p>
    </FeatureCard>
  );
}
