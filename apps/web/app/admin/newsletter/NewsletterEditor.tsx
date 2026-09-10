"use client";
import { useEffect, useState } from "react";
import type { NewsletterContent, NewsletterStory } from "@/lib/newsletter/content";

type Issue = { id: string; revision: number; status: string; window_start: string; window_end: string; content: NewsletterContent; candidates: NewsletterStory[]; preview: string;
  testAttempted: boolean; testAccepted: boolean; source_health: { source: string; status: string; sampled: boolean }[];
  deliveries: { total: number; accepted: number; pending: number; uncertain: number } };
const api = "/api/admin/newsletter";
export default function NewsletterEditor() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<NewsletterContent | null>(null);
  const [canTest, setCanTest] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const issue = issues.find(i => i.id === selected);
  const dirty = !!issue && JSON.stringify(content) !== JSON.stringify(issue.content);
  const editable = issue && ["draft", "approved"].includes(issue.status);
  async function load(id?: string) {
    const response = await fetch(api, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load issues");
    setIssues(data.issues); setCanSend(data.canSend); setCanTest(data.canTest); setTestRecipient(data.testRecipient);
    const next = data.issues.find((i: Issue) => i.id === id) ?? data.issues[0];
    setSelected(next?.id ?? ""); setContent(next?.content ?? null); setReviewed(false); setConfirmSend(false);
  }
  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);
  async function action(action: "prepare" | "save" | "approve" | "send" | "test" | "refresh") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "prepare" || action === "refresh" ? { action } : {
        action, id: selected, revision: issue?.revision, ...(action === "save" ? { content } : {}), ...(action === "approve" ? { evidenceReviewed: reviewed } : {}), ...(action === "send" ? { inboxChecked: confirmSend } : {}),
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error([result.error, ...(result.details ?? []), result.message].filter(Boolean).join(" — "));
      await load(result.id ?? selected);
      setMessage(action === "test" ? "Test accepted by the email provider. Check your inbox and the links before sending to readers." : action === "send" ? "Batch processed. Check the delivery counts before continuing." : "Saved. Preview reflects the saved issue.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  }
  function updateStory(index: number, key: keyof NewsletterStory, value: string | string[]) {
    if (!content) return;
    setContent({ ...content, stories: content.stories.map((s, i) => i === index ? { ...s, [key]: value } : s) }); setReviewed(false);
  }
  return <main className="mx-auto max-w-6xl p-6 text-slate-900">
    <h1 className="text-3xl font-bold">Arthur’s Watch</h1>
    <p className="my-3">Prepare the week’s evidence, edit the warnings, review the saved preview, then choose when to send.</p>
    <button disabled={busy || dirty} onClick={() => action("prepare")} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">Prepare this week’s draft</button>
    <button disabled={busy || dirty} onClick={() => action("refresh")} className="ml-3 rounded border px-4 py-2 disabled:opacity-40">Refresh this week’s source list</button>
    <p role="status" className="my-4">{message}</p>
    <label>Issue <select disabled={dirty || busy} value={selected} onChange={e => { const next = issues.find(i => i.id === e.target.value); setSelected(e.target.value); setContent(next?.content ?? null); setReviewed(false); setConfirmSend(false); }} className="m-2 border p-2">
      {issues.map(i => <option key={i.id} value={i.id}>{i.window_start.slice(0, 10)} — {i.status}</option>)}
    </select></label>
    {issue && content && <>
      <p>Source window: {issue.window_start.slice(0, 10)} to {issue.window_end.slice(0, 10)} (end excluded). Revision {issue.revision} · {issue.status}</p>
      <p className="my-2">{issue.source_health.map(s => `${s.source}: ${s.status}${s.sampled ? " (sample limit reached)" : ""}`).join(" · ")}</p>
      <p className="my-2">Inbound newsletters remain private research. <a className="underline" href="/admin/inbound-quarantine">Review inbound quarantine</a></p>
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <fieldset disabled={!editable || busy}>
            <label className="my-3 block">Subject<input className="mt-1 w-full border p-2" value={content.subject} onChange={e => { setContent({ ...content, subject: e.target.value }); setReviewed(false); }} /></label>
            <label className="my-3 block">Inbox preview text<input className="mt-1 w-full border p-2" value={content.preheader} onChange={e => { setContent({ ...content, preheader: e.target.value }); setReviewed(false); }} /></label>
            {content.stories.map((story, index) => <article key={story.id} className="my-5 rounded border p-4">
              <h2 className="font-bold">{index === 0 ? "Lead warning" : `Warning ${index + 1}`}</h2>
              <a href={story.sourceUrl} target="_blank" rel="noreferrer" className="underline">{story.sourceLabel}</a>
              <p className="text-sm">{story.jurisdiction} · {story.sourceDate.slice(0, 10)}</p>
              {(["title", "summary", "take", "action"] as const).map(key => <label key={key} className="my-3 block">{({ title: "Headline", summary: "What happened", take: "Arthur’s Take", action: "What to do" })[key]}<textarea className="mt-1 w-full border p-2" rows={key === "title" ? 2 : 3} value={story[key]} onChange={e => updateStory(index, key, e.target.value)} /></label>)}
              <label className="block">Spot it — one clue per line<textarea className="mt-1 w-full border p-2" rows={3} value={story.tells.join("\n")} onChange={e => updateStory(index, "tells", e.target.value.split("\n"))} /></label>
              <button className="mt-3 underline" onClick={() => { setContent({ ...content, stories: content.stories.filter((_, i) => i !== index) }); setReviewed(false); }}>Remove warning</button>
            </article>)}
            <label className="block">Add a source (up to three warnings)<select className="my-2 w-full border p-2" value="" disabled={content.stories.length >= 3} onChange={e => { const candidate = issue.candidates.find(c => c.id === e.target.value); if (candidate) { setContent({ ...content, stories: [...content.stories, candidate] }); setReviewed(false); } }}>
              <option value="">Choose evidence to review…</option>
              {issue.candidates.filter(c => !content.stories.some(s => s.id === c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select></label>
            <button disabled={!dirty || busy} onClick={() => action("save")} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">Save and refresh preview</button>
          </fieldset>
          {editable && <div className="my-5 border-t pt-4">
            <label><input type="checkbox" checked={reviewed} disabled={dirty || busy} onChange={e => setReviewed(e.target.checked)} /> I checked the sources, claims, practical advice and saved preview.</label>
            <button disabled={!reviewed || dirty || busy || issue.status === "approved"} onClick={() => action("approve")} className="my-3 block rounded border p-2 disabled:opacity-40">Approve revision {issue.revision}</button>
            <p className="text-sm">Any saved edit removes approval. Approval does not send.</p>
          </div>}
          <div className="my-5 border-t pt-4">
            <p>Test recipient: {testRecipient}. One test per approved revision.</p>
            <button disabled={!canTest || dirty || busy || issue.status !== "approved" || issue.testAttempted} onClick={() => action("test")} className="my-3 rounded border p-2 disabled:opacity-40">Send saved issue to my test inbox</button>
            {issue.testAttempted && <p>{issue.testAccepted ? "Test accepted by provider — check your inbox." : "Test outcome uncertain — reconcile before trying again."}</p>}
            <p>Recipients: {issue.deliveries.total}. Accepted: {issue.deliveries.accepted}. Pending: {issue.deliveries.pending}. Uncertain: {issue.deliveries.uncertain}.</p>
            {issue.deliveries.uncertain > 0 && <p>Uncertain sends need provider reconciliation and will not be automatically retried.</p>}
            {!canSend && <p>Sending is disabled in this environment.</p>}
            <label className="my-3 block"><input type="checkbox" checked={confirmSend} onChange={e => setConfirmSend(e.target.checked)} disabled={!canSend || dirty || busy} /> I checked this revision in my inbox. Send it to subscribed readers now.</label>
            <button disabled={!canSend || !issue.testAccepted || !confirmSend || dirty || busy || !["approved", "sending"].includes(issue.status)} onClick={() => action("send")} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40">{issue.status === "sending" ? "Continue pending recipients" : "Send approved issue"}</button>
          </div>
        </section>
        <section><h2 className="my-3 text-xl font-bold">Saved email preview</h2><p className="mb-2 text-sm">{dirty ? "Unsaved changes — save to update this preview." : "This is the saved revision."}</p><iframe title="Saved newsletter preview" sandbox="" srcDoc={issue.preview} className="h-[1000px] w-full border" /></section>
      </div>
    </>}
  </main>;
}
