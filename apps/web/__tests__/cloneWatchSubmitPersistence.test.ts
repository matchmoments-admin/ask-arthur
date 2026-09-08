import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), reputation: vi.fn(), submit: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => ({ rpc: m.rpc }) }));
vi.mock("@askarthur/scam-engine", () => ({ checkURLReputation: m.reputation }));
vi.mock("@askarthur/scam-engine/urlscan", () => ({ submitURLScanWithDetails: m.submit }));
import { submitCloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";
const candidate = { id: 1, candidate_url: "https://clone.example", candidate_domain: "clone.example" };
beforeEach(() => {
 vi.clearAllMocks();
 m.reputation.mockResolvedValue([{ isMalicious: false, sources: [] }]);
 m.rpc.mockResolvedValue({ error: { message: "write failed" } });
});
it("does not report success when recording a successful external submission fails", async () => {
 m.submit.mockResolvedValue({ ok: true, uuid: "scan-1" });
 await expect(submitCloneCandidate(candidate)).rejects.toThrow("write failed");
});
it("does not lose a reputation-only verdict when persistence fails", async () => {
 m.reputation.mockResolvedValue([{ isMalicious: true, sources: [] }]);
 m.submit.mockResolvedValue({ ok: false, status: 400, error: "rejected" });
 await expect(submitCloneCandidate(candidate)).rejects.toThrow("write failed");
});
it("uses the atomic persistence RPC for a reputation-only verdict", async () => {
 m.rpc.mockResolvedValue({ error: null });
 m.reputation.mockResolvedValue([{ isMalicious: true, sources: [] }]);
 m.submit.mockResolvedValue({ ok: false, status: 400, error: "rejected" });
 expect((await submitCloneCandidate(candidate)).kind).toBe("reputation_classified");
 expect(m.rpc).toHaveBeenCalledTimes(1);
 expect(m.rpc.mock.calls[0][0]).toBe("persist_clone_alert_urlscan");
});
it("leaves the database untouched on quota exhaustion", async () => {
 m.submit.mockResolvedValue({ ok: false, status: 429, error: "rate_limited" });
 expect((await submitCloneCandidate(candidate)).kind).toBe("rate_limited");
 expect(m.rpc).not.toHaveBeenCalled();
});
