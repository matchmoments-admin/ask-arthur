"use client";

import { useState } from "react";

// Booking-call next step. Set NEXT_PUBLIC_BOOKING_URL to a hosted booking page
// (Outlook "Bookings with me" / Google Calendar appointment schedule); falls
// back to /contact.
const BOOKING_URL =
  process.env.NEXT_PUBLIC_BOOKING_URL || "/contact";

// Clone Watch lead magnet form. Posts to /api/clone-list-request (dark unless
// FF_CLONE_LIST_REQUEST is on). Placed on the pillar / monthly-index pages and
// gated there by the public flag — this component is presentation only.
export default function CloneListRequestForm({ defaultBrand = "" }: { defaultBrand?: string }) {
  const [email, setEmail] = useState("");
  const [brand, setBrand] = useState(defaultBrand);
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !brand.trim() || !consent) return;
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/clone-list-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          brand: brand.trim(),
          company: company.trim() || undefined,
          consent: true,
        }),
      });
      if (res.status === 422) {
        setState("error");
        setMsg("Please use a work email address.");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json().catch(() => ({}))) as { monitored?: boolean };
      setState("done");
      setMsg(
        data.monitored === false
          ? `We don't monitor ${brand.trim()} yet — we've logged your request and will be in touch.`
          : "Sent — check your inbox for your brand's Clone Watch list.",
      );
    } catch {
      setState("error");
      setMsg("Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="mb-3">{msg}</p>
        <a
          href={BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-full bg-deep-navy px-5 py-2 text-sm font-semibold text-white"
        >
          Book a 15-min call →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-deep-navy/15 bg-white p-5">
      <p className="text-deep-navy font-semibold mb-1">Get your brand&apos;s clone list</p>
      <p className="text-gov-slate text-sm mb-4">
        See the suspected lookalike domains we&apos;re tracking for your brand — emailed as a CSV.
        For brand, security, and compliance teams.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work email"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand or domain (e.g. hesta.com.au)"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company (optional)"
          className="rounded border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
        />
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs text-gov-slate">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I agree to Ask Arthur contacting me about this list and its scam-prevention
          services. See the{" "}
          <a href="/privacy" className="underline">privacy policy</a>.
        </span>
      </label>
      <button
        type="submit"
        disabled={state === "sending" || !email.trim() || !brand.trim() || !consent}
        className="mt-4 rounded-full bg-deep-navy px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Email me the list"}
      </button>
      {msg && state === "error" && <p className="mt-2 text-xs text-rose-600">{msg}</p>}
    </form>
  );
}
