import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock("@askarthur/mcp-audit", () => ({ scanSkill: m.scan }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => null }));
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10, resetAt: null }),
}));

import { POST } from "@/app/api/skill-audit/route";

const META = {
  skill: { slug: "demo", displayName: "Demo", summary: "s", stats: { downloads: 0, installsAllTime: 0, stars: 0 }, tags: { latest: "1" } },
  owner: { handle: "o" },
};

async function zipWith(skillMd: string) {
  const z = new JSZip();
  z.file("SKILL.md", skillMd);
  return z.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function stubFetch(download: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/download")) return download();
      if (url.includes("/versions")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(META), { headers: { "content-type": "application/json" } });
    }),
  );
}

const req = () =>
  POST(new Request("https://x.test/api/skill-audit", { method: "POST", body: JSON.stringify({ skillId: "demo" }) }) as never);

beforeEach(() => {
  m.scan.mockReset();
  m.scan.mockResolvedValue({ checks: [], meta: {}, overallScore: 100, grade: "A" });
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/skill-audit — ClawHub size caps", () => {
  it("scans SKILL.md content under the caps", async () => {
    const bytes = await zipWith("# real skill body");
    stubFetch(() => new Response(bytes));
    const res = await req();
    expect(res.status).toBe(200);
    expect(m.scan).toHaveBeenCalledWith(expect.objectContaining({ skillContent: "# real skill body" }));
  });

  it("returns an explicit not-assessed result when SKILL.md inflates past its cap", async () => {
    const bytes = await zipWith("0".repeat(3 * 1024 * 1024));
    stubFetch(() => new Response(bytes));
    const res = await req();
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ assessed: false, message: expect.stringContaining("too large to assess") });
    expect(m.scan).not.toHaveBeenCalled(); // never a metadata-only "clean" scan
  });

  it("returns an explicit not-assessed result when the package download is over its cap", async () => {
    stubFetch(() => new Response(new Uint8Array(6 * 1024 * 1024)));
    const res = await req();
    expect(res.status).toBe(413);
    expect(m.scan).not.toHaveBeenCalled();
  });
});

describe("POST /api/skill-audit — no silent metadata-only results", () => {
  it.each([
    ["download fails", () => new Response("nope", { status: 500 }), 502],
    ["empty package", () => new Response(null), 502],
  ])("%s → explicit not-assessed", async (_l, download, status) => {
    stubFetch(download as () => Response);
    const res = await req();
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject({ assessed: false });
    expect(body.message).toMatch(/not assessed/);
    expect(m.scan).not.toHaveBeenCalled();
  });

  it("package without SKILL.md → explicit not-assessed", async () => {
    const z = new JSZip();
    z.file("README.md", "# hi");
    const bytes = await z.generateAsync({ type: "arraybuffer" });
    stubFetch(() => new Response(bytes));
    const res = await req();
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/no SKILL\.md/);
    expect(m.scan).not.toHaveBeenCalled();
  });
});
