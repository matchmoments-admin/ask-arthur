// /api/brand-stewardship/unsubscribe — the one brand-contact opt-out store.
//
// PR-C review (2026-09-28): the founder-outreach email's unsubscribe link now
// points here, so a brand contact's opt-out lands in brand_report_unsubscribes,
// which the Brand Send Gate's `unsubscribe` check reads for every brand send.
// (Before, outreach linked to the consumer /unsubscribe page, whose RPC only
// UPDATEs an existing email_subscribers row — for a brand contact, a no-op.)
//
// Go-red (2026-09-28): `source` hard-coded back to "brand_stewardship_email"
// → "labels an outreach opt-out" FAILED; SOURCES check removed (raw src
// written) → "an unknown src cannot inject a label" FAILED.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upsert = vi.fn(async () => ({ error: null }));
const tables: string[] = [];
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      tables.push(t);
      return { upsert };
    },
  }),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

process.env.UNSUBSCRIBE_SECRET ??= "test-secret-for-unsubscribe-hmac-000000";

import { signUnsubscribeUrl } from "@/lib/unsubscribe";
import { GET, POST } from "@/app/api/brand-stewardship/unsubscribe/route";

const BASE = "https://askarthur.au/api/brand-stewardship/unsubscribe";

beforeEach(() => {
  upsert.mockClear();
  tables.length = 0;
});

describe("brand opt-out store", () => {
  it("labels an outreach opt-out and writes brand_report_unsubscribes", async () => {
    const url = `${signUnsubscribeUrl("Security@PNBank.com.au", BASE)}&src=brand_outreach`;
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
    expect(tables).toEqual(["brand_report_unsubscribes"]);
    expect(upsert).toHaveBeenCalledWith(
      { email: "security@pnbank.com.au", source: "brand_outreach" },
      expect.anything(),
    );
  });

  it("keeps the stewardship default without src (one-click POST)", async () => {
    const res = await POST(new NextRequest(signUnsubscribeUrl("a@b.au", BASE), { method: "POST" }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      { email: "a@b.au", source: "brand_stewardship_email" },
      expect.anything(),
    );
  });

  it("an unknown src cannot inject a label", async () => {
    await GET(new NextRequest(`${signUnsubscribeUrl("a@b.au", BASE)}&src=%3Cscript%3E`));
    expect(upsert).toHaveBeenCalledWith(
      { email: "a@b.au", source: "brand_stewardship_email" },
      expect.anything(),
    );
  });

  it("a bad token writes nothing", async () => {
    await GET(new NextRequest(`${BASE}?email=a%40b.au&token=nope&src=brand_outreach`));
    expect(upsert).not.toHaveBeenCalled();
  });
});
