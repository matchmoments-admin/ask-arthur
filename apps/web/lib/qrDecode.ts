import { decodeQR } from "qr/decode.js";

/**
 * Attempt to decode a QR code from an image file.
 * Returns the decoded string or null if no QR code found.
 * Never throws — all errors are caught and return null.
 */
export async function tryDecodeQR(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    return decodeQR({ data, width, height }) || null;
  } catch {
    return null;
  }
}
