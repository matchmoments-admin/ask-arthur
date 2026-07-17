// Evidence-check reference generator (ADR-0022). IC- + 12 Crockford-base32
// chars (~60 bits): human-quotable over the phone (no 0/O/1/I/L ambiguity),
// and unguessable enough that the public /image-check/[ref] page can be
// keyed on the ref alone.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CHECK_REF_PATTERN = /^IC-[0-9A-HJKMNP-TV-Z]{12}$/;

export function generateCheckRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += CROCKFORD[b % 32];
  }
  return `IC-${out}`;
}
