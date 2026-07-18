"use client";

import { useState } from "react";

interface Props {
  /** Pilot starter body (with a {{hook}} placeholder) from the shared lib. */
  pilotTemplate: string;
}

interface SendResult {
  ok?: boolean;
  mode?: "shadow" | "real";
  recipient?: string;
  error?: string;
  detail?: string;
}

/**
 * Compose + send one founder-to-brand pilot email.
 *
 * SAFETY: the primary (prominent) action is "Send test to myself" — the
 * testMode path that routes to the founder's own inbox and never touches the
 * brand. "Send to brand" is the deliberate secondary action, behind an
 * explicit confirm dialog. There is no bulk/loop send — one recipient per
 * request.
 */
export default function BrandOutreach({ pilotTemplate }: Props) {
  const [to, setTo] = useState("");
  const [brandName, setBrandName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadTemplate = () => {
    setBody(pilotTemplate);
    if (!subject) {
      setSubject(
        brandName
          ? `${brandName} × Ask Arthur — a quick pilot idea`
          : "A quick pilot idea",
      );
    }
  };

  const send = async (testMode: boolean) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/brand-outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          brandName,
          subject,
          bodyMarkdown_or_html: body,
          testMode,
        }),
      });
      const json: SendResult = await res.json();
      if (res.ok && json.ok) {
        setStatus(
          json.mode === "real"
            ? `Sent to ${json.recipient} ✓`
            : `Test sent to ${json.recipient} (your inbox) ✓`,
        );
      } else {
        setStatus(`Error: ${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`);
      }
    } catch {
      setStatus("Request failed");
    } finally {
      setBusy(false);
    }
  };

  const onSendToBrand = () => {
    if (!to || !brandName || !subject || !body) {
      setStatus("Fill in recipient, brand, subject and body first.");
      return;
    }
    const ok = window.confirm(
      `Send this REAL email to ${to} (${brandName})?\n\nThis is an external send and cannot be un-sent. Have you sent yourself a test first and re-read the body?`,
    );
    if (ok) void send(false);
  };

  const canSend = Boolean(to && brandName && subject && body) && !busy;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-6 lg:py-8">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Brand reach-out</h1>
        <p className="mt-1 max-w-prose text-xs text-slate-500">
          Compose and send ONE personal pilot email to a single brand contact
          (the clone-watch shortlist — P&amp;N Bank, Airwallex, Reece, …). You
          write the body; Ask Arthur wraps it in a plain signature + legal
          footer. This is the manual four-eyes path — distinct from the
          automated stewardship report send. Always send yourself a test first.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bo-to" className="mb-1 block text-sm font-medium">
            Recipient email
          </label>
          <input
            id="bo-to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="security@brand.com.au"
            className="w-full rounded border border-slate-300 p-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label htmlFor="bo-brand" className="mb-1 block text-sm font-medium">
            Brand name
          </label>
          <input
            id="bo-brand"
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="P&N Bank"
            className="w-full rounded border border-slate-300 p-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="bo-subject" className="mb-1 block text-sm font-medium">
          Subject
        </label>
        <input
          id="bo-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A quick pilot idea"
          className="w-full rounded border border-slate-300 p-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="bo-body" className="block text-sm font-medium">
            Body
          </label>
          <button
            type="button"
            onClick={loadTemplate}
            className="text-[11px] text-teal-600 hover:text-teal-800"
          >
            Load pilot template
          </button>
        </div>
        <textarea
          id="bo-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          placeholder="Write your note. Light markdown works (bold, links, lists). Replace the {{hook}} with a real, brand-specific opening line before sending."
          className="w-full rounded border border-slate-300 p-2 font-mono text-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Markdown supported. A signature + ABN footer + STOP line are appended
          automatically — don&apos;t add your own.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={canSend === false}
          onClick={() => void send(true)}
          className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
        >
          Send test to myself
        </button>
        <button
          type="button"
          disabled={canSend === false}
          onClick={onSendToBrand}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
        >
          Send to brand…
        </button>
        <p
          className="min-h-[1.25rem] text-sm text-slate-600"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      </div>
    </div>
  );
}
