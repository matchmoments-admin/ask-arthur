import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports; vi.hoisted gets our mock
// fns up there with them so the factory closure can capture them.
const { upsertMock, maybeSingleMock, createServiceClientMock, loggerMock } =
  vi.hoisted(() => ({
    upsertMock: vi.fn(),
    maybeSingleMock: vi.fn(),
    createServiceClientMock: vi.fn(),
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: loggerMock,
}));

import {
  __resetDetectionCacheForTests,
  recordDetection,
  recordDetections,
} from "../vuln-detect";

function makeFakeClient(opts: {
  vulnRow?: { id: number } | null;
  lookupError?: { message: string } | null;
  upsertError?: { message: string } | null;
}) {
  maybeSingleMock.mockResolvedValue({
    data: opts.vulnRow === undefined ? { id: 42 } : opts.vulnRow,
    error: opts.lookupError ?? null,
  });
  upsertMock.mockResolvedValue({ error: opts.upsertError ?? null });

  return {
    from: vi.fn((table: string) => {
      if (table === "vulnerabilities") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: maybeSingleMock,
            }),
          }),
        };
      }
      if (table === "vulnerability_detections") {
        return {
          upsert: upsertMock,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  __resetDetectionCacheForTests();
  upsertMock.mockReset();
  maybeSingleMock.mockReset();
  createServiceClientMock.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  loggerMock.debug.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("recordDetection — happy path", () => {
  it("looks up vulnerability_id then upserts the detection row", async () => {
    const client = makeFakeClient({ vulnRow: { id: 42 } });
    createServiceClientMock.mockReturnValue(client);

    await recordDetection({
      identifier: "CVE-2025-6514",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "mcp-remote",
      targetVersion: "0.5.0",
      evidence: { downloads: 558_000 },
      scanId: "scan_abc",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertMock.mock.calls[0];
    expect(row).toEqual({
      vulnerability_id: 42,
      scanner: "mcp-audit",
      target_type: "npm_package",
      target_value: "mcp-remote",
      target_version: "0.5.0",
      evidence: { downloads: 558_000 },
      scan_id: "scan_abc",
    });
    expect(opts).toEqual({
      onConflict: "vulnerability_id,target_type,target_value,target_version",
      ignoreDuplicates: true,
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("coerces NULL/undefined targetVersion to 'unknown' so the unique key dedupes", async () => {
    createServiceClientMock.mockReturnValue(makeFakeClient({ vulnRow: { id: 1 } }));

    await recordDetection({
      identifier: "CVE-2025-4144",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "@cloudflare/workers-oauth-provider",
      // no targetVersion
    });

    const [row] = upsertMock.mock.calls[0];
    expect(row.target_version).toBe("unknown");
  });

  it("caches identifier→id so a second call doesn't re-query vulnerabilities", async () => {
    createServiceClientMock.mockReturnValue(makeFakeClient({ vulnRow: { id: 7 } }));

    await recordDetection({
      identifier: "CVE-2025-6514",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "mcp-remote",
    });
    await recordDetection({
      identifier: "CVE-2025-6514",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "mcp-remote",
      targetVersion: "0.6.0",
    });

    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });
});

describe("recordDetection — graceful skip paths", () => {
  it("returns silently when createServiceClient() returns null (no env)", async () => {
    createServiceClientMock.mockReturnValue(null);

    await recordDetection({
      identifier: "CVE-2025-6514",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "mcp-remote",
    });

    expect(upsertMock).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("warns and skips when identifier is unknown to vulnerabilities table", async () => {
    createServiceClientMock.mockReturnValue(makeFakeClient({ vulnRow: null }));

    await recordDetection({
      identifier: "CVE-9999-99999",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "ghost-pkg",
    });

    expect(upsertMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).toMatch(/identifier not in vulnerabilities/);
  });
});

describe("recordDetection — error paths never throw", () => {
  it("logs and swallows errors when the lookup fails", async () => {
    createServiceClientMock.mockReturnValue(
      makeFakeClient({ vulnRow: null, lookupError: { message: "connection reset" } })
    );

    await expect(
      recordDetection({
        identifier: "CVE-2025-6514",
        scanner: "mcp-audit",
        targetType: "npm_package",
        targetValue: "mcp-remote",
      })
    ).resolves.toBeUndefined();

    expect(upsertMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows errors when the upsert fails", async () => {
    createServiceClientMock.mockReturnValue(
      makeFakeClient({ vulnRow: { id: 1 }, upsertError: { message: "deadlock" } })
    );

    await expect(
      recordDetection({
        identifier: "CVE-2025-6514",
        scanner: "mcp-audit",
        targetType: "npm_package",
        targetValue: "mcp-remote",
      })
    ).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/insert failed/);
  });

  it("scrubs non-serializable evidence (BigInt) to {} and warns", async () => {
    createServiceClientMock.mockReturnValue(makeFakeClient({ vulnRow: { id: 1 } }));

    await recordDetection({
      identifier: "CVE-2025-6514",
      scanner: "mcp-audit",
      targetType: "npm_package",
      targetValue: "mcp-remote",
      evidence: { huge: BigInt("9007199254740993") } as unknown as Record<string, unknown>,
    });

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [row] = upsertMock.mock.calls[0];
    expect(row.evidence).toEqual({});
  });
});

describe("recordDetections — bulk", () => {
  it("processes every candidate even if one fails", async () => {
    // Lookup returns id=1 for the first call, null for the second, id=3 for the third.
    createServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "vulnerabilities") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: maybeSingleMock }),
            }),
          };
        }
        return { upsert: upsertMock };
      },
    });
    maybeSingleMock
      .mockResolvedValueOnce({ data: { id: 1 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 3 }, error: null });
    upsertMock.mockResolvedValue({ error: null });

    await recordDetections([
      {
        identifier: "CVE-A",
        scanner: "mcp-audit",
        targetType: "npm_package",
        targetValue: "pkg-a",
      },
      {
        identifier: "CVE-MISSING",
        scanner: "mcp-audit",
        targetType: "npm_package",
        targetValue: "pkg-b",
      },
      {
        identifier: "CVE-C",
        scanner: "mcp-audit",
        targetType: "npm_package",
        targetValue: "pkg-c",
      },
    ]);

    // Two upserts (the missing identifier was skipped, not failed)
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });
});
