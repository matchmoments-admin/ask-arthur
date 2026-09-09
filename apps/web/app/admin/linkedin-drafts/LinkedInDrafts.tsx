"use client";
import { useCallback, useEffect, useState } from "react";
import type { LinkedInDraft } from "@/lib/linkedin/drafts";

const errors: Record<string, string> = {
  drafts_unavailable: "Drafts could not be loaded. Check the database setup and try again.",
  store_unavailable: "Storage is unavailable. Your changes have not been saved.",
  save_failed: "The draft could not be saved. Your text is still in the editor.",
  draft_changed_reload: "This draft changed in another session. Reload before editing it again.",
  draft_changed_or_already_attempted: "This draft changed or publishing was already attempted. Reload to check its status.",
  publication_uncertain_check_linkedin: "LinkedIn did not confirm the outcome. Check the company page before any retry. This draft is locked to avoid duplicate posts.",
  linkedin_connection_unavailable: "The LinkedIn connection needs attention. Your draft has not been published.",
  publishing_not_enabled: "Publishing is not enabled for this environment or company page.",
};
export default function LinkedInDrafts() {
  const [drafts, setDrafts] = useState<LinkedInDraft[]>([]);
  const [selected, setSelected] = useState<LinkedInDraft | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const dirty = selected ? title !== selected.title || text !== selected.commentary : !!(title || text);
  const locked = !!selected && selected.status !== "draft";
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/linkedin-drafts", { cache: "no-store" });
      if (!response.ok) throw new Error("drafts_unavailable");
      const data = await response.json();
      setDrafts(data.drafts); setEnabled(data.canPublish); setLoaded(true);
    } catch { setLoaded(false); setMessage(errors.drafts_unavailable); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function choose(draft: LinkedInDraft | null) {
    if (dirty && !window.confirm("Discard the unsaved changes in the editor?")) return;
    setSelected(draft); setTitle(draft?.title ?? ""); setText(draft?.commentary ?? "");
    setReview(false); setMessage(""); setPublishedUrl("");
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/linkedin-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected?.id, version: selected?.version, title, commentary: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelected(data.draft); setTitle(data.draft.title); setText(data.draft.commentary);
      setMessage("Draft saved. It will stay here until you choose to publish."); await load();
    } catch (err) { setMessage(errors[err instanceof Error ? err.message : ""] ?? "Could not save. Your text is still in the editor."); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!selected || dirty || !review) return;
    setBusy(true); setMessage("");
    // Lock locally even if the browser loses the response. Reload the server state.
    setSelected({ ...selected, status: "publishing" });
    try {
      const response = await fetch("/api/admin/linkedin-drafts/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, version: selected.version, publishNow: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPublishedUrl(data.url);
      setMessage(data.receiptSaved ? "LinkedIn accepted the post. Open it to check that it is visible." : "LinkedIn accepted the post, but its receipt could not be saved. Keep the post link and do not republish.");
    } catch (err) { setMessage(errors[err instanceof Error ? err.message : ""] ?? "The outcome is unknown. Reload and check LinkedIn before trying again."); }
    finally { setReview(false); await load(); setBusy(false); }
  }
  const button = "rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed";
  return <main className="mx-auto max-w-6xl p-4 md:p-8 text-slate-800">
    <h1 className="text-2xl font-semibold">LinkedIn drafts</h1>
    <p className="mt-2 mb-6">Write, save and preview posts for Ask Arthur’s company page. You choose when each one goes live.</p>
    {!enabled && loaded && <p className="mb-4 rounded bg-amber-50 p-3">Draft editing is available. Publishing needs the production LinkedIn connection enabled.</p>}
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside className="space-y-3" aria-label="Saved drafts">
        <div className="flex gap-2"><button className={button} disabled={!loaded || busy} onClick={() => choose(null)}>New draft</button><button className={button} disabled={busy} onClick={() => void load()}>Reload</button></div>
        {!loaded && <p>Drafts are not loaded yet.</p>}
        {drafts.map(draft => <button key={draft.id} disabled={busy} onClick={() => choose(draft)} aria-pressed={selected?.id === draft.id} className={`block w-full rounded border p-3 text-left ${selected?.id === draft.id ? "border-blue-700 bg-blue-50" : "border-slate-200"}`}><strong className="block">{draft.title}</strong><span className="text-sm">{draft.status === "uncertain" ? "Check LinkedIn" : draft.status}</span></button>)}
      </aside>
      <section className="space-y-4">
        <label className="block">Draft title <span className="text-sm text-slate-500">(only visible here)</span><input className="mt-1 w-full rounded border p-2" value={title} maxLength={120} disabled={!loaded || busy || locked || review} onChange={e => setTitle(e.target.value)} /></label>
        <label className="block">Post text<textarea className="mt-1 min-h-64 w-full rounded border p-3" value={text} maxLength={3000} disabled={!loaded || busy || locked || review} onChange={e => setText(e.target.value)} /></label>
        <p className="text-sm">{text.length} / 3,000 characters{dirty ? " · Unsaved changes" : ""}</p>
        <div className="flex flex-wrap gap-3"><button className={button} onClick={() => void save()} disabled={!loaded || busy || locked || review || !dirty || !title.trim() || !text.trim()}>Save draft</button><button className={button} onClick={() => setReview(true)} disabled={!loaded || busy || locked || dirty || !selected || !enabled || review}>Review for publishing</button></div>
        {locked && <p className="rounded bg-slate-100 p-3">{selected?.status === "published" ? "This draft has been published." : "Publishing was attempted. Reload to check its status. If it remains unresolved, check the company page and ask an operator to reconcile the result before retrying."}</p>}
        <section aria-label="Post preview" className="rounded border bg-white p-5"><h2 className="font-semibold">Ask Arthur · Public post preview</h2><p className="mt-4 whitespace-pre-wrap break-words">{text || "Your post preview will appear here."}</p><p className="mt-4 text-xs text-slate-500">Text preview. LinkedIn controls the final feed layout.</p></section>
        {review && <section aria-label="Confirm publication" className="rounded border-2 border-blue-700 p-4"><h2 className="font-semibold">Publish this saved post now?</h2><p className="my-3">The exact text above will be posted publicly to Ask Arthur’s LinkedIn company page.</p><div className="flex gap-3"><button className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={() => void publish()}>{busy ? "Publishing…" : "Publish now"}</button><button className={button} disabled={busy} onClick={() => setReview(false)}>Keep as draft</button></div></section>}
        {message && <p role="status" className="rounded bg-slate-100 p-3">{message}</p>}
        {(publishedUrl || selected?.post_urn) && <a className="inline-block underline" target="_blank" rel="noopener noreferrer" href={publishedUrl || `https://www.linkedin.com/feed/update/${selected!.post_urn}`}>Open post on LinkedIn</a>}
      </section>
    </div>
  </main>;
}
