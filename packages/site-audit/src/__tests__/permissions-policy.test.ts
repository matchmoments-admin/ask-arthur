import { describe, it, expect } from "vitest";
import {
  checkPermissionsPolicy,
  parsePermissionsPolicy,
  parseFeaturePolicy,
} from "../checks/permissions-policy";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("parsePermissionsPolicy", () => {
  it("parses empty allowlists as restricted", () => {
    const result = parsePermissionsPolicy("camera=(), microphone=()");
    expect(result).toHaveLength(2);
    expect(result[0].feature).toBe("camera");
    expect(result[0].isRestricted).toBe(true);
    expect(result[0].allowlist).toEqual([]);
  });

  it("parses self-only allowlists", () => {
    const result = parsePermissionsPolicy("geolocation=(self)");
    expect(result[0].feature).toBe("geolocation");
    expect(result[0].allowlist).toEqual(["self"]);
    expect(result[0].isRestricted).toBe(true);
  });

  it("parses wildcard as unrestricted", () => {
    const result = parsePermissionsPolicy("camera=(*)");
    expect(result[0].isRestricted).toBe(false);
  });
});

describe("parseFeaturePolicy", () => {
  it("parses legacy format", () => {
    const result = parseFeaturePolicy("camera 'none'; microphone 'self'");
    expect(result).toHaveLength(2);
    expect(result[0].feature).toBe("camera");
    expect(result[0].isRestricted).toBe(true);
  });
});

describe("checkPermissionsPolicy", () => {
  it("passes when most sensitive features restricted", () => {
    const headers = makeHeaders({
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), autoplay=()",
    });
    const result = checkPermissionsPolicy(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(10);
  });

  it("warns when few features restricted", () => {
    const headers = makeHeaders({
      "permissions-policy": "camera=(), microphone=()",
    });
    const result = checkPermissionsPolicy(headers);
    expect(result.status).toBe("warn");
  });

  it("fails when no policy present", () => {
    const headers = makeHeaders({});
    const result = checkPermissionsPolicy(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });

  it("falls back to Feature-Policy", () => {
    const headers = makeHeaders({
      "feature-policy":
        "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; bluetooth 'none'; autoplay 'none'",
    });
    const result = checkPermissionsPolicy(headers);
    expect(result.status).toBe("pass");
  });
});
