// Validate image magic bytes to prevent disguised file uploads.
// Checks actual file content, not declared MIME type.

const MAGIC_BYTES: Array<{ type: string; sig: number[] }> = [
  { type: "image/jpeg", sig: [0xff, 0xd8, 0xff] },
  { type: "image/png", sig: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/gif", sig: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/webp", sig: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
];

export function validateImageMagicBytes(
  base64: string
): { valid: boolean; detectedType: string | null } {
  let buf: Buffer;
  try {
    // Strip data URI prefix if present
    const raw = base64.replace(/^data:[^;]+;base64,/, "");
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
