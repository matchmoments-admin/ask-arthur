import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { approvalProblems, IssueContent, newsletterWindow, safeEvidenceUrl, safeProse } from "@/lib/newsletter/content";
import ArthursWatch from "@/emails/ArthursWatch";
const story = {
  id: "take:1", title: "An unexpected payment request", summary: "A reader reported an unexpected request.",
  take: "Urgency discourages an independent check.", tells: ["Pressure to act immediately"], action: "Check through a known contact.",
  sourceLabel: "Arthur’s Take — Reddit report", sourceUrl: "https://askarthur.au/scam-feed/1",
  sourceDate: "2026-09-03T10:00:00Z", jurisdiction: "Location not established as Australian",
};
const content = { subject: "Arthur’s Watch", preheader: "A practical warning", stories: [story] };

describe("newsletter editorial contract", () => {
  it("uses one complete bounded week across repeat preparations", () => {
    expect(newsletterWindow(new Date("2026-09-10T13:00:00Z"))).toEqual({ start: "2026-08-31T00:00:00.000Z", end: "2026-09-07T00:00:00.000Z" });
    expect(newsletterWindow(new Date("2026-09-13T23:59:59Z"))).toEqual(newsletterWindow(new Date("2026-09-07T00:00:00Z")));
    expect(newsletterWindow(new Date("2026-09-14T00:00:00Z")).start).toBe("2026-09-07T00:00:00.000Z");
  });
  it.each(["https://askarthur.au.evil.test/a", "javascript:alert(1)", "https://evil.test@askarthur.au/a", "http://askarthur.au/a", "https://askarthur.au:444/a"])("rejects unsafe source %s", value => expect(safeEvidenceUrl(value)).toBe(false));
  it("requires explicit safe evidence and rejects repeated stories", () => {
    expect(IssueContent.safeParse(content).success).toBe(true);
    expect(IssueContent.safeParse({ ...content, stories: [story, story] }).success).toBe(false);
    expect(IssueContent.safeParse({ ...content, stories: [] }).success).toBe(false);
  });
  it("binds approval to the original evidence", () => {
    expect(approvalProblems(content, [story])).toEqual([]);
    expect(approvalProblems({ ...content, stories: [{ ...story, sourceUrl: "https://www.cyber.gov.au/" }] }, [story])).toHaveLength(1);
    expect(approvalProblems({ ...content, stories: [{ ...story, action: "Add the safe next step recommended by the source." }] }, [story])[0]).toContain("Finish");
  });
  it("defangs domains throughout prose", () => {
    expect(safeProse("Go to https://login.example.com/path or example.com")).toBe("Go to hxxps://login[.]example[.]com/path or example[.]com");
  });
  it("renders the lead once, concrete actions, public CTA and personalised opt-out", async () => {
    const html = await render(ArthursWatch({ content, unsubscribeUrl: "https://askarthur.au/unsubscribe?token=test" }));
    expect(html.match(/An unexpected payment request/g)).toHaveLength(1);
    expect(html).toContain("What to do:"); expect(html).toContain("Arthur’s Take");
    expect(html).toContain("utm_campaign=arthurs-watch"); expect(html).not.toContain("/app/threats");
    expect(html).toContain("unsubscribe?token=test");
    const text = await render(ArthursWatch({ content }), { plainText: true });
    expect(text).toContain("Check through a known contact");
  });
});
