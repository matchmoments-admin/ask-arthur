import { describe, it, expect, vi } from "vitest";

// Mock browser-image-compression before importing our module
const mockCompress = vi.fn();
vi.mock("browser-image-compression", () => ({
  default: (...args: unknown[]) => mockCompress(...args),
}));

import { compressImage } from "@/lib/compressImage";

function makeFile(
  name: string,
  size: number,
  type: string = "image/png"
): File {
  // Create a File with a specific size by filling an ArrayBuffer
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

describe("compressImage", () => {
  it("skips non-image files", async () => {
    const file = makeFile("doc.pdf", 1_000_000, "application/pdf");
    const result = await compressImage(file);
    expect(result).toBe(file);
    expect(mockCompress).not.toHaveBeenCalled();
  });

  it("skips images already under 500KB", async () => {
    const file = makeFile("small.png", 400_000, "image/png");
    const result = await compressImage(file);
    expect(result).toBe(file);
    expect(mockCompress).not.toHaveBeenCalled();
  });

  it("skips images exactly at 500KB", async () => {
    const file = makeFile("exact.png", 500 * 1024, "image/png");
    const result = await compressImage(file);
    expect(result).toBe(file);
    expect(mockCompress).not.toHaveBeenCalled();
  });

  it("compresses images over 500KB", async () => {
    const original = makeFile("big.png", 3_000_000, "image/png");
    const compressed = makeFile("big.webp", 400_000, "image/webp");
    mockCompress.mockResolvedValueOnce(compressed);

    const result = await compressImage(original);
    expect(result).toBe(compressed);
    expect(mockCompress).toHaveBeenCalledWith(original, {
      maxSizeMB: 500 / 1024,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: "image/webp",
      exifOrientation: undefined,
    });
  });

  it("returns original if compressed is larger", async () => {
    const original = makeFile("photo.jpg", 600_000, "image/jpeg");
    const bigger = makeFile("photo.webp", 700_000, "image/webp");
    mockCompress.mockResolvedValueOnce(bigger);

    const result = await compressImage(original);
    expect(result).toBe(original);
  });

  it("returns original if compressed is same size", async () => {
    const original = makeFile("photo.jpg", 600_000, "image/jpeg");
    const same = makeFile("photo.webp", 600_000, "image/webp");
    mockCompress.mockResolvedValueOnce(same);

    const result = await compressImage(original);
    expect(result).toBe(original);
  });

  it("falls back to original on compression error", async () => {
    const original = makeFile("broken.png", 2_000_000, "image/png");
    mockCompress.mockRejectedValueOnce(new Error("WebWorker failed"));

    const result = await compressImage(original);
    expect(result).toBe(original);
  });
});
