import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), cost: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.cost, PRICING: { RESEND_USD_PER_EMAIL: 0.0009 } }));
vi.mock("@/lib/unsubscribe", () => ({ signUnsubscribeUrl: (_email: string, base: string) => `${base}?token=signed` }));
import { sendWeeklyDigest, sendWeeklyIntelDigest } from "@/lib/resend";
beforeEach(() => { vi.clearAllMocks(); });
const senders = [
  (emails: string[]) => sendWeeklyDigest(emails, "A synthetic weekly summary"),
  (emails: string[]) => sendWeeklyIntelDigest(emails, {
    weekStart: "2026-09-01", weekEnd: "2026-09-07", totalPostsClassified: 0,
    emergingThemes: [], topBrands: [], topCategories: [], scamOfTheWeekQuote: null,
    modelVersion: "fixture", promptVersion: "fixture",
  }),
];
describe.each(senders)("weekly send receipt accounting", (send) => {
  it("rejects a fulfilled SDK promise containing a provider error", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: "rejected" } });
    await expect(send(["reader@example.test"])).rejects.toThrow("weekly_email_batch_failed");
    expect(mocks.cost).not.toHaveBeenCalled();
  });
  it("counts only accepted recipients and reports partial failure", async () => {
    mocks.send.mockResolvedValueOnce({ data: { id: "accepted" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    await expect(send(["one@example.test", "two@example.test"])).rejects.toThrow();
    expect(mocks.cost).toHaveBeenCalledWith(expect.objectContaining({ units: 1, metadata: expect.objectContaining({ failed: 1 }) }));
  });
  it("accepts a batch only with provider receipts", async () => {
    mocks.send.mockResolvedValue({ data: { id: "accepted" }, error: null });
    await expect(send(["reader@example.test"])).resolves.toBeUndefined();
  });
});
