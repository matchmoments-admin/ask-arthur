"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type WorklistRow,
  signalSummary,
  buildComposerBody,
  bucketWorklist,
} from "@/lib/email/brand-outreach-worklist";
import type { BrandCloneSample } from "@/emails/BrandOutreachPilot";
import { lifecycleBadge } from "@/lib/clone-watch/outcome-copy";

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
 * Compose + send one founder-to-brand pilot email, driven by a live
 * "Next brand to email" worklist.
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
  // Stable brand key (worklist domain) — recorded on the send so the worklist
  // knows this brand was contacted. Cleared if the operator hand-edits the
  // recipient (the send is then no longer tied to that worklist brand).
  const [brandKey, setBrandKey] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [rows, setRows] = useState<WorklistRow[] | null>(null);
  const [worklistError, setWorklistError] = useState<string | null>(null);

  // Clone sample that WILL be embedded in the pilot email — previewed here so
  // the founder sees the evidence before sending, and so the "enough data to
  // pitch" warning can fire (founder's rule: only pitch brands we have lots of
  // data on).
  const [cloneSample, setCloneSample] = useState<BrandCloneSample | null>(null);
  const [sampleState, setSampleState] = useState<
    "idle" | "loading" | "error"
  >("idle");

  const loadCloneSample = useCallback(async (key: string) => {
    setSampleState("loading");
    setCloneSample(null);
    try {
      const res = await fetch(
        `/api/admin/brand-outreach/clone-sample?brandKey=${encodeURIComponent(key)}`,
      );
      const json = await res.json();
      if (res.ok && json.ok) {
        setCloneSample((json.sample as BrandCloneSample | null) ?? null);
        setSampleState("idle");
      } else {
        setSampleState("error");
      }
    } catch {
      setSampleState("error");
    }
  }, []);

  const loadWorklist = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brand-outreach/worklist");
      const json = await res.json();
      if (res.ok && json.ok) {
        setRows(json.rows as WorklistRow[]);
        setWorklistError(null);
      } else {
        setWorklistError(json.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setWorklistError("request_failed");
    }
  }, []);

  useEffect(() => {
    void loadWorklist();
  }, [loadWorklist]);

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

  const loadFromWorklist = (row: WorklistRow) => {
    setTo(row.contact_recipient ?? "");
    setBrandName(row.brand_name);
    setBrandKey(row.brand_key);
    setSubject(`${row.brand_name} × Ask Arthur — clone-watch pilot`);
    setBody(buildComposerBody(row));
    setStatus(`Loaded ${row.brand_name} — replace {{hook}} and review before sending.`);
    void loadCloneSample(row.brand_key);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          brandKey: brandKey ?? undefined,
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
        if (json.mode === "real") void loadWorklist(); // refresh contacted flags
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

  const buckets = rows ? bucketWorklist(rows) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-6 lg:py-8">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Brand reach-out</h1>
        <p className="mt-1 max-w-prose text-xs text-slate-500">
          Compose and send ONE personal pilot email to a single brand contact.
          You write the body; Ask Arthur wraps it in a plain signature + legal
          footer. This is the manual four-eyes path — distinct from the
          automated stewardship report send. Always send yourself a test first.
        </p>
      </header>

      {/* ── Compose form ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bo-to" className="mb-1 block text-sm font-medium">
            Recipient email
          </label>
          <input
            id="bo-to"
            type="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setBrandKey(null); // hand-edited → no longer a worklist-tracked brand
              setCloneSample(null); // sample was tied to the worklist brand
              setSampleState("idle");
            }}
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

      {/* ── Clone sample preview (what the email will include) ── */}
      {brandKey && (
        <section className="mt-8 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <h2 className="text-sm font-semibold">
            Evidence the email will include
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            A live sample of the clones we&apos;ve detected + reported for{" "}
            {brandName || "this brand"} in the last 30 days — this is embedded,
            styled, in the pilot email.
          </p>

          {sampleState === "loading" && (
            <p className="mt-3 text-xs text-slate-400">Loading sample…</p>
          )}
          {sampleState === "error" && (
            <p className="mt-3 text-xs text-amber-600">
              Couldn&apos;t load the clone sample. You can still send, but the
              email won&apos;t carry evidence.
            </p>
          )}

          {sampleState === "idle" && cloneSample && (
            <div className="mt-3">
              {/* Founder's rule: warn (don't block) on thin data. */}
              {cloneSample.insufficientData ? (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800">
                    ⚠ Insufficient recent data — not a strong outreach target
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                    Only <strong>{cloneSample.reportedCount}</strong> reported
                    clone
                    {cloneSample.reportedCount === 1 ? "" : "s"} for{" "}
                    {brandName || "this brand"} in the last{" "}
                    {cloneSample.windowDays} days ({cloneSample.totalCount}{" "}
                    detected total). We only want to pitch brands we have lots of
                    data on — consider a stronger candidate from the worklist.
                    You can still send if you have a reason to.
                  </p>
                </div>
              ) : (
                <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-800">
                    ✓ Strong evidence: {cloneSample.reportedCount} reported ·{" "}
                    {cloneSample.totalCount} detected
                    {cloneSample.weaponisedCount > 0 && (
                      <> · {cloneSample.weaponisedCount} active phishing</>
                    )}
                    {cloneSample.takenDownCount > 0 && (
                      <> · {cloneSample.takenDownCount} taken down</>
                    )}
                  </p>
                </div>
              )}

              {cloneSample.rows.length > 0 ? (
                <ul className="space-y-1.5">
                  {cloneSample.rows.map((r) => {
                    const badge = lifecycleBadge(r.lifecycleState);
                    return (
                      <li
                        key={r.domain}
                        className="rounded border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-xs text-slate-800">
                            {r.domain}
                          </code>
                          {badge && (
                            <span
                              className="text-[10px] font-bold"
                              style={{ color: badge.color }}
                            >
                              {badge.label}
                            </span>
                          )}
                          {r.reportedToNetcraft && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                              reported
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {r.detectedAt
                            ? `Detected ${new Date(r.detectedAt).toLocaleDateString("en-AU")}`
                            : "Detected recently"}
                          {r.host ? ` · ${r.host}` : ""}
                          {r.registrar ? ` · ${r.registrar}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  No clone detections for this brand in the last 30 days — nothing
                  to show as evidence.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Next brand to email ── */}
      <section className="mt-10 border-t border-slate-200 pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Next brand to email</h2>
          <button
            type="button"
            onClick={() => void loadWorklist()}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >
            refresh
          </button>
        </div>
        <p className="mb-3 text-[11px] text-slate-400">
          Ranked live from clone-watch signals (weaponised → live → in-campaign)
          among brands with a resolvable security contact. &quot;Load into
          composer&quot; fills the recipient, brand, and a generated pitch.
        </p>

        {worklistError && (
          <p className="text-xs text-amber-600">
            Couldn&apos;t load the worklist ({worklistError}). The RPC may not be
            applied yet.
          </p>
        )}
        {!rows && !worklistError && (
          <p className="text-xs text-slate-400">Loading…</p>
        )}

        {buckets && (
          <>
            {buckets.eligible.length === 0 ? (
              <p className="text-xs text-slate-500">
                No eligible brands right now (every candidate is recently
                contacted or parked as enterprise).
              </p>
            ) : (
              <ul className="space-y-2">
                {buckets.eligible.map((row) => (
                  <WorklistItem key={row.brand_key} row={row} onLoad={loadFromWorklist} />
                ))}
              </ul>
            )}

            {buckets.contacted.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-slate-500">
                  Already contacted (last 30d) — {buckets.contacted.length}
                </summary>
                <ul className="mt-2 space-y-2">
                  {buckets.contacted.map((row) => (
                    <WorklistItem key={row.brand_key} row={row} onLoad={loadFromWorklist} muted />
                  ))}
                </ul>
              </details>
            )}

            {buckets.enterprise.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500">
                  Enterprise — parked ({buckets.enterprise.length}) · founder-led-light rule
                </summary>
                <ul className="mt-2 space-y-2">
                  {buckets.enterprise.map((row) => (
                    <WorklistItem key={row.brand_key} row={row} onLoad={loadFromWorklist} muted />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function WorklistItem({
  row,
  onLoad,
  muted,
}: {
  row: WorklistRow;
  onLoad: (row: WorklistRow) => void;
  muted?: boolean;
}) {
  return (
    <li
      className={`flex items-start justify-between gap-3 rounded border p-3 ${
        muted ? "border-slate-100 bg-slate-50" : "border-slate-200"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.brand_name}</span>
          {row.likely_enterprise && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
              enterprise
            </span>
          )}
          {row.contacted_recently && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
              contacted
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">{signalSummary(row)}</p>
        {row.contact_recipient && (
          <p className="truncate text-[11px] text-slate-400">
            {row.contact_recipient} · {row.contact_channel}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onLoad(row)}
        className="shrink-0 rounded border border-teal-600 px-2.5 py-1 text-xs text-teal-700 hover:bg-teal-50"
      >
        Load into composer
      </button>
    </li>
  );
}
