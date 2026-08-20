import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyC2PA } from "../c2pa-verify";
import { detectC2PA } from "../c2pa-detect";

// Exercises the REAL @contentauth/c2pa-node native binding — no mocks. If
// the platform binary is missing (postinstall blocked / unsupported target),
// these tests fail rather than silently pass: that is the signal the
// FF_IMAGE_CHECK_C2PA_VALIDATE path would be inert in this environment.

const FIXTURE = join(__dirname, "fixtures", "c2pa", "signed-valid.jpg");

function loadSigned(): Buffer {
  return readFileSync(FIXTURE);
}

describe("verifyC2PA", () => {
  it("fixture sanity: the presence sniff agrees a manifest exists", () => {
    expect(detectC2PA(loadSigned())).toEqual({ present: true, format: "jpeg" });
  });

  it("validates the signed fixture: signature holds, issuer + generator extracted", async () => {
    const result = await verifyC2PA(loadSigned(), "image/jpeg");
    expect(result).not.toBeNull();
    // Test cert is not on the production trust list → "valid", not "trusted".
    expect(["valid", "trusted"]).toContain(result!.validationState);
    expect(result!.signatureValid).toBe(true);
    expect(result!.issuer).toBe("C2PA Test Signing Cert");
    expect(result!.generator).toMatch(/make_test_images|c2pa/i);
  });

  it("reports 'invalid' when pixel data was altered after signing", async () => {
    const tampered = loadSigned();
    tampered[tampered.length - 1000] ^= 0xff;
    const result = await verifyC2PA(tampered, "image/jpeg");
    expect(result).not.toBeNull();
    expect(result!.validationState).toBe("invalid");
    expect(result!.signatureValid).toBe(false);
  });

  it("returns null (fall back to presence-only) for a manifest-less image", async () => {
    const plain = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x05, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff,
      0xd9,
    ]);
    expect(await verifyC2PA(plain, "image/jpeg")).toBeNull();
  });

  it("returns null (never throws) on garbage bytes", async () => {
    expect(await verifyC2PA(Buffer.from("not an image"), "image/jpeg")).toBeNull();
    expect(await verifyC2PA(Buffer.alloc(0), "image/jpeg")).toBeNull();
  });
});
