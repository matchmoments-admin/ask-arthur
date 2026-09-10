import { expect, it } from "vitest";
import { prepareNewsletter } from "@/lib/newsletter/prepare";

type Row = Record<string, unknown>;
function fixture(failedTable?: string) {
  const feed = (date: string, published = true) => ({ title: "A suspicious request", source_created_at: date, published, source: "reddit" });
  const take = (id: number, date: string, published = true) => ({ feed_item_id: id, confidence: 0.9, take_status: "ready", is_scam_report: null, take_tells: ["Pressure", "Secrecy"], narrative_summary: "A person reported a suspicious request.", take_au_line: "Check independently.", country_hints: ["AU"], processed_at: "2026-09-06T00:00:00Z", feed_items: feed(date, published) });
  const tables: Record<string, Row[]> = {
    newsletter_issues: [], reddit_post_intel: [take(1, "2026-09-03T00:00:00Z"), take(2, "2025-01-01T00:00:00Z"), take(3, "2026-09-03T00:00:00Z", false), take(4, "2026-09-07T00:00:00Z"), { ...take(5, "2026-09-03T00:00:00Z"), is_scam_report: false }],
    feed_items: [], shopfront_clone_alerts: [],
  };
  const sb = { from(table: string) {
    const predicates: ((r: Row) => boolean)[] = [];
    let single = false;
    let mutation: Row | null = null;
    const value = (r: Row, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v as Row)?.[k], r);
    const q = {
      select: () => q, order: () => q, limit: () => q,
      or: () => { predicates.push(r => r.is_scam_report === null || r.is_scam_report === true); return q; },
      eq: (key: string, v: unknown) => { predicates.push(r => value(r, key) === v); return q; },
      is: (key: string, v: unknown) => { predicates.push(r => value(r, key) === v); return q; },
      in: (key: string, v: unknown[]) => { predicates.push(r => v.includes(value(r, key))); return q; },
      gte: (key: string, v: string | number) => { predicates.push(r => String(value(r, key)) >= String(v)); return q; },
      lt: (key: string, v: string) => { predicates.push(r => String(value(r, key)) < v); return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      update: (row: Row) => { mutation = row; return q; },
      upsert: (row: Row) => { if (!tables[table].length) tables[table].push({ ...row, id: "issue", revision: 1, status: "draft" }); return q; },
      then: (resolve: (result: unknown) => void) => {
        const rows = tables[table].filter(r => predicates.every(p => p(r)));
        if (mutation) rows.forEach(row => Object.assign(row, mutation));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: table === failedTable ? { message: "unavailable" } : null }).then(resolve);
      },
    }; return q;
  } };
  return { sb: sb as unknown as Parameters<typeof prepareNewsletter>[0], tables };
}
it("admits eligible legacy Takes with an unknown report flag but excludes false, old, unpublished and out-of-window records", async () => {
  const { sb } = fixture();
  const issue = await prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"));
  expect(issue.candidates.map((c: { id: string }) => c.id)).toEqual(["take:1"]);
  expect(JSON.stringify(issue.content)).not.toMatch(/weeklyReportCount|noveltySignal|memberCount/);
});
it("keeps an edited draft on repeat preparation", async () => {
  const { sb, tables } = fixture();
  await prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"));
  tables.newsletter_issues[0].content = { subject: "My editorial changes" };
  const issue = await prepareNewsletter(sb, new Date("2026-09-11T10:00:00Z"));
  expect(issue.content).toEqual({ subject: "My editorial changes" });
});
it("still prepares regulator evidence on a quiet Reddit week", async () => {
  const { sb, tables } = fixture(); tables.reddit_post_intel = [];
  tables.feed_items = [{ id: 7, title: "An official alert", url: "https://www.cyber.gov.au/alert", published: true, published_at: "2026-09-03T00:00:00Z", source: "acsc" }];
  const issue = await prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"));
  expect(issue.candidates.map((c: { id: string }) => c.id)).toEqual(["feed:7"]);
});
it("does not disguise a failed source read as an empty week", async () => {
  const { sb, tables } = fixture("reddit_post_intel");
  await expect(prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"))).rejects.toThrow("sources_unavailable");
  expect(tables.newsletter_issues).toHaveLength(0);
});

it("refreshes candidates while preserving editorial changes", async () => {
  const { sb, tables } = fixture();
  await prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"));
  tables.newsletter_issues[0].content = { subject: "Keep my edits" };
  tables.reddit_post_intel = [];
  const refreshed = await prepareNewsletter(sb, new Date("2026-09-10T11:00:00Z"), true);
  expect(refreshed.content).toEqual({ subject: "Keep my edits" }); expect(refreshed.candidates).toEqual([]);
});
it("refuses to refresh an approved issue", async () => {
  const { sb, tables } = fixture(); await prepareNewsletter(sb, new Date("2026-09-10T10:00:00Z"));
  tables.newsletter_issues[0].status = "approved";
  await expect(prepareNewsletter(sb, new Date("2026-09-10T11:00:00Z"), true)).rejects.toThrow("only_draft");
});
