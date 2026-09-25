import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), reputation: vi.fn(), submit: vi.fn(), host: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => ({ rpc: m.rpc }) }));
vi.mock("@askarthur/scam-engine", () => ({ checkURLReputation: m.reputation }));
vi.mock("@askarthur/scam-engine/urlscan", () => ({ submitURLScanWithDetails: m.submit }));
vi.mock("@/lib/clone-watch/liveness", () => ({ submitPrecheck: m.host }));
import {
 DNS_PRECHECK_ERROR,
 DNS_SERVFAIL_PRECHECK_ERROR,
 submitCloneCandidate,
} from "@/lib/clone-watch/urlscan-submit-one";
const candidate = { id: 1, candidate_url: "https://clone.example", candidate_domain: "clone.example" };
beforeEach(() => {
 vi.clearAllMocks();
 m.reputation.mockResolvedValue([{ isMalicious: false, sources: [] }]);
 m.rpc.mockResolvedValue({ error: { message: "write failed" } });
 m.host.mockResolvedValue("host");
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

// DNS precheck (2026-09-23; PR B): a name with no A/AAAA costs no urlscan and
// no reputation call, and is stamped exactly like urlscan's no-DNS 400 so the
// v277 dead-domain cadence applies unchanged. The gate is "points at a host",
// not "not NXDOMAIN": a zone with NS but no A (prod sucway.net, apple.co.mw,
// amazom.yoga) still drew urlscan's "400 DNS Error" under the old check.
it("skips urlscan + reputation for a name with no host and stamps a 400", async () => {
 m.host.mockResolvedValue("no_host");
 m.rpc.mockResolvedValue({ error: null });
 const out = await submitCloneCandidate(candidate);
 expect(DNS_PRECHECK_ERROR).toBe("dns_no_host_precheck");
 expect(out).toMatchObject({ kind: "dns_no_host", error: DNS_PRECHECK_ERROR });
 expect(m.submit).not.toHaveBeenCalled();
 expect(m.reputation).not.toHaveBeenCalled();
 const evidence = m.rpc.mock.calls[0][1].p_evidence;
 expect(evidence).toMatchObject({ status: 400, error: DNS_PRECHECK_ERROR });
});
it("an inconclusive resolver answer still scans", async () => {
 m.host.mockResolvedValue("unknown");
 m.rpc.mockResolvedValue({ error: null });
 m.submit.mockResolvedValue({ ok: true, uuid: "scan-2" });
 await submitCloneCandidate(candidate);
 expect(m.submit).toHaveBeenCalledTimes(1);
});

// 2026-09-25: A and AAAA both SERVFAIL — every such name measured in prod was
// also refused by urlscan ("could not resolve"). Skipped like no_host, stamped
// with the same status-400 shape (same 168 h cadence), counted apart.
it("skips urlscan + reputation for a SERVFAIL name and stamps a 400 with its own error", async () => {
 m.host.mockResolvedValue("servfail");
 m.rpc.mockResolvedValue({ error: null });
 const out = await submitCloneCandidate(candidate);
 expect(out).toMatchObject({ kind: "dns_servfail", error: DNS_SERVFAIL_PRECHECK_ERROR });
 expect(m.submit).not.toHaveBeenCalled();
 expect(m.reputation).not.toHaveBeenCalled();
 const evidence = m.rpc.mock.calls[0][1].p_evidence;
 expect(evidence).toMatchObject({ status: 400, error: "dns_servfail_precheck", stage: "submit_failed" });
});

