// Evidence-check reference generator (ADR-0022). <prefix>- + 12
// Crockford-base32 chars (~60 bits): human-quotable over the phone (no
// 0/O/1/I/L ambiguity), and unguessable enough that the public evidence
// pages (/image-check/[ref], /document-check/[ref]) are keyed on the ref
// alone. Two prefixes = two adapters at this seam: IC- (image checks,
// v239) and DC- (document checks, v281).

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type CheckRefPrefix = "IC" | "DC";

export const CHECK_REF_PATTERN = /^IC-[0-9A-HJKMNP-TV-Z]{12}$/;
export const DOCUMENT_CHECK_REF_PATTERN = /^DC-[0-9A-HJKMNP-TV-Z]{12}$/;

export function generateCheckRef(prefix: CheckRefPrefix = "IC"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += CROCKFORD[b % 32];
  }
  return `${prefix}-${out}`;
}
