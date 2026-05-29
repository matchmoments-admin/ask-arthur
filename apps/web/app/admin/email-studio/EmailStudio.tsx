"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface StudioSlot {
  key: string;
  label: string;
  default: string;
}
export interface StudioTemplate {
  key: string;
  label: string;
  vars: string[];
  editable: boolean;
  slots: StudioSlot[];
}

interface Props {
  templates: StudioTemplate[];
  overrides: Record<string, Record<string, string>>;
}

export default function EmailStudio({ templates, overrides }: Props) {
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key ?? "");
  // draft[templateKey][slotKey] = current editor value
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(() => {
    const d: Record<string, Record<string, string>> = {};
    for (const t of templates) {
      d[t.key] = {};
      for (const s of t.slots) {
        d[t.key][s.key] = overrides[t.key]?.[s.key] ?? s.default;
      }
    }
    return d;
  });
  const [previewHtml, setPreviewHtml] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => templates.find((t) => t.key === selectedKey),
    [templates, selectedKey],
  );

  const fetchPreview = useCallback(
    async (key: string, copy?: Record<string, string>) => {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/email-studio/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateKey: key, copy }),
        });
        const json = await res.json();
        setPreviewHtml(res.ok ? json.html : `<p style="padding:20px">Preview error: ${json.error}</p>`);
      } catch {
        setPreviewHtml('<p style="padding:20px">Preview failed</p>');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Preview whenever the selected template changes (with its current draft).
  useEffect(() => {
    if (selectedKey) fetchPreview(selectedKey, draft[selectedKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const onSlotChange = (slotKey: string, value: string) => {
    setDraft((d) => ({ ...d, [selectedKey]: { ...d[selectedKey], [slotKey]: value } }));
  };

  const action = async (path: string, okMsg: string) => {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/email-studio/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          path === "save"
            ? { templateKey: selectedKey, slots: draft[selectedKey] }
            : { templateKey: selectedKey, copy: draft[selectedKey] },
        ),
      });
      const json = await res.json();
      setStatus(res.ok ? okMsg : `Error: ${json.error ?? res.status}`);
    } catch {
      setStatus("Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row">
      {/* Template list */}
      <aside className="w-full shrink-0 lg:w-64">
        <h1 className="mb-1 text-lg font-semibold">Email Studio</h1>
        <p className="mb-4 text-xs text-slate-500">
          Edit the prose of outbound emails. Layout/branding stay in code.
          Brand-facing copy still needs #371 legal review.
        </p>
        <ul className="max-h-56 space-y-1 overflow-y-auto lg:max-h-none">
          {templates.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                aria-current={t.key === selectedKey ? "true" : undefined}
                onClick={() => setSelectedKey(t.key)}
                className={`w-full rounded px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  t.key === selectedKey ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                }`}
              >
                {t.label}
                {!t.editable && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                    preview
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Editor + preview */}
      <main className="flex min-w-0 flex-1 flex-col gap-6 xl:flex-row">
        <section className="w-full shrink-0 xl:w-[420px]">
          {selected?.editable ? (
            <>
              {selected.vars.length > 0 && (
                <p className="mb-3 text-xs text-slate-500">
                  Variables you can use: {selected.vars.map((v) => `{{${v}}}`).join(", ")}.
                  Markdown supported (bold, links, lists).
                </p>
              )}
              {selected.slots.map((s) => (
                <div key={s.key} className="mb-4">
                  <label
                    htmlFor={`slot-${s.key}`}
                    className="mb-1 block text-sm font-medium"
                  >
                    {s.label}
                  </label>
                  <textarea
                    id={`slot-${s.key}`}
                    value={draft[selectedKey]?.[s.key] ?? ""}
                    onChange={(e) => onSlotChange(s.key, e.target.value)}
                    rows={4}
                    className="w-full rounded border border-slate-300 p-2 font-mono text-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() => onSlotChange(s.key, s.default)}
                    className="mt-1 text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    reset to default
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fetchPreview(selectedKey, draft[selectedKey])}
                  className="rounded bg-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  Preview changes
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action("test-send", "Test email sent to you")}
                  className="rounded bg-teal-600 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  Send test to me
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action("save", "Saved")}
                  className="rounded bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p
                className="mt-3 min-h-[1.25rem] text-sm text-slate-600"
                role="status"
                aria-live="polite"
              >
                {status}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Preview only — this template has no editable slots yet. Editing its
              wording is a code change (PR). Adding slots is a mechanical
              follow-up via the copy registry.
            </p>
          )}
        </section>

        <section className="min-w-0 flex-1">
          <div className="mb-2 text-xs text-slate-500" aria-live="polite">
            Live preview (sample data){busy ? " — rendering…" : ""}
          </div>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={previewHtml}
            className="h-[500px] w-full rounded border border-slate-200 bg-white sm:h-[640px] xl:h-[800px]"
          />
        </section>
      </main>
    </div>
  );
}
