import { describe, it, expect, vi } from "vitest";
import type { AnalysisResult } from "@askarthur/types";

// The bot "Report scam" flow: stash mapping + the cross-platform reply builder
// + the graceful fallback when Redis/stash is unavailable.

vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
// No Redis in the test env → getBotRedis returns null.
vi.mock("../../lib/bots/redis", () => ({ getBotRedis: () => null }));

import {
  buildReportStash,
  buildReportReply,
  reportBotScam,
  type ResolvedDestination,
} from "@/lib/bots/onward-report";

const RESULT = {
  verdict: "HIGH_RISK",
  confidence: 0.95,
  summary: "Bank impersonation phishing",
  redFlags: ["urgent language", "credential request", "lookalike domain"],
  nextSteps: [],
  scamType: "phishing",
  impersonatedBrand: "NAB",
  scammerContacts: {
    phoneNumbers: [{ value: "+61400000000", context: "sms sender" }],
    emailAddresses: [{ value: "fraud@nab-secure.example", context: "reply-to" }],
  },
} as unknown as AnalysisResult;

describe("buildReportStash", () => {
  it("maps analysis fields into a compact stash", () => {
    const stash = buildReportStash(42, RESULT);
    expect(stash).toMatchObject({
      scamReportId: 42,
      scamType: "phishing",
      impersonatedBrand: "NAB",
      scammerPhones: ["+61400000000"],
      scammerEmails: ["fraud@nab-secure.example"],
    });
    expect(stash.redFlags).toContain("lookalike domain");
  });
});

describe("buildReportReply", () => {
  const dests: ResolvedDestination[] = [
    {
      destination: "scamwatch",
      destination_key: "scamwatch.gov.au",
      display_name: "Scamwatch (National Anti-Scam Centre)",
      contact_type: "webform",
    },
    {
      destination: "ask_arthur_feed",
      destination_key: "askarthur.au",
      display_name: "Ask Arthur threat feed",
      contact_type: "inproduct",
    },
    {
      destination: "acma_email_spam",
      destination_key: "report@submit.spam.acma.gov.au",
      display_name: "ACMA spam intake",
      contact_type: "email",
    },
  ];
  const stash = buildReportStash(42, RESULT);

  it("renders deep-links, submitted lines, feed note + evidence when submitted", () => {
    const reply = buildReportReply(dests, stash, true);
    expect(reply).toContain("Ask Arthur threat feed"); // feed note fires
    expect(reply).toContain("Reported on your behalf:");
    expect(reply).toContain("ACMA spam intake");
    expect(reply).toContain("portal.scamwatch.gov.au"); // deep-link
    expect(reply).toContain("--- Copy-paste evidence ---");
    expect(reply).toContain("AA-42"); // report ref
    expect(reply).toContain("NAB"); // impersonated brand in evidence
  });

  it("omits the 'reported on your behalf' block when submit failed", () => {
    const reply = buildReportReply(dests, stash, false);
    expect(reply).toContain("Here's how to report this scam");
    expect(reply).not.toContain("Reported on your behalf:");
    // deep-link + evidence still offered so the user can report manually
    expect(reply).toContain("portal.scamwatch.gov.au");
    expect(reply).toContain("--- Copy-paste evidence ---");
  });
});

describe("reportBotScam", () => {
  it("returns null (→ static fallback) when Redis is unavailable", async () => {
    const reply = await reportBotScam("whatsapp", "user-1");
    expect(reply).toBeNull();
  });
});
