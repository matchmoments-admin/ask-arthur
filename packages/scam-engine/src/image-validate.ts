// Validate image magic bytes to prevent disguised file uploads.
// Checks actual file content, not declared MIME type.

const MAGIC_BYTES: Array<{ type: string; sig: number[] }> = [
  { type: "image/jpeg", sig: [0xff, 0xd8, 0xff] },
  { type: "image/png", sig: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/gif", sig: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/webp", sig: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
];

// Hard cap matching the per-image Zod limit upstream. Prevents allocation
// amplification: a rejected 8 MB base64 string would otherwise still decode
// into a 6 MB Buffer before we check its magic bytes.
const MAX_DECODED_BYTES = 5_000_000;

export function validateImageMagicBytes(
  base64: string
): { valid: boolean; detectedType: string | null } {
  // Strip data URI prefix if present
  const raw = base64.replace(/^data:[^;]+;base64,/, "");

  // Pre-check decoded size from the encoded length, without allocating a Buffer.
  // base64 decoded bytes = floor(len * 3 / 4) - padding
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  const decodedSize = Math.floor((raw.length * 3) / 4) - padding;
  if (decodedSize > MAX_DECODED_BYTES) {
    return { valid: false, detectedType: null };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return { valid: false, detectedType: null };
  }

  if (buf.length < 4) {
    return { valid: false, detectedType: null };
  }

  for (const { type, sig } of MAGIC_BYTES) {
    if (sig.every((byte, i) => buf[i] === byte)) {
      return { valid: true, detectedType: type };
    }
  }

  return { valid: false, detectedType: null };
}
