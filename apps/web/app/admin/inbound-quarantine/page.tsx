import { requireAdmin } from "@/lib/adminAuth";
import {
  getQuarantineRows,
  type QuarantineRow,
} from "@/lib/dashboard/inbound-quarantine";
import QuarantineTable from "./QuarantineTable";

export const dynamic = "force-dynamic";

// Re-export so existing consumers that did `import { QuarantineRow } from
// "./page"` (or sibling components) continue to compile.
export type { QuarantineRow };

export default async function InboundQuarantinePage() {
  await requireAdmin();
  const rows = await getQuarantineRows();
  const adminCount = rows.filter((r) => r.is_subscription_admin).length;
  const realCount = rows.length - adminCount;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-deep-navy text-3xl font-bold">Inbound-email quarantine</h1>
          <p className="mt-2 text-sm text-gov-slate leading-relaxed max-w-3xl">
            Every inbound-email row lands here with <code className="font-mono text-xs">published=false</code>.
            Promote a row to publish it to the public <a href="/scam-feed" className="text-action-teal underline">/scam-feed</a>;
            delete a row for subscription confirmations, welcome emails, and pipeline test traffic that
            should never have arrived. The newsletter-classifier (P3) will eventually automate both
            decisions; until then this is the only path to the public feed for inbound rows.
          </p>
          <div className="mt-4 flex gap-3 text-xs">
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-amber-900">
              {realCount} candidate{realCount === 1 ? "" : "s"} (real content)
            </span>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-700">
              {adminCount} subscription-admin (delete)
            </span>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-700">
              {rows.length} total
            </span>
          </div>
        </header>

        <QuarantineTable rows={rows} />
      </div>
    </div>
  );
}
