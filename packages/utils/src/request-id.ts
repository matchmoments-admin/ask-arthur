import { ulid } from "ulid";

/**
 * Request ID / Idempotency Key helpers.
 *
 * Clients can send `Idempotency-Key` (Stripe-style) to make a retry safe:
 * the server echoes the key back as `X-Request-Id`, threads it through the
 * pipeline as the Inngest event id, and persists it as the scam_reports
 * idempotency_key. A Postgres partial unique index makes the second call
 * return the original row id without re-running the write.
 *
 * When the header is absent we generate a server-side ULID. ULIDs are
 * 26-char Crockford-base32, time-ordered (48-bit ms timestamp + 80 bits
 * of randomness), URL-safe without encoding, and cheap to generate.
 * Time-ordering helps B-tree locality on the idempotency index and makes
 * ULIDs visually sortable during debugging.
 */

/** Accept ULIDs, UUIDv4, and Stripe-style custom keys (alnum + hyphen/underscore). */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

/**
 * Validate an incoming idempotency key. Rejects empty strings, oversized
 * inputs, and characters that could break SQL parameter quoting or HTTP
 * header round-trips.
 */
export function isValidIdempotencyKey(value: string | null | undefined): value is string {
  if (!value) return false;
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

/**
 * Resolve the canonical request id for an incoming request:
 * - If the caller sent a well-formed `Idempotency-Key` header, use it.
 * - Otherwise generate a fresh ULID.
 *
 * The returned string is the authoritative id used for: logging
 * correlation, the response `X-Request-Id` header, the Inngest event id,
 * and the scam_reports.idempotency_key column.
 */
export function resolveRequestId(headers: Headers): string {
  const supplied = headers.get("idempotency-key") ?? headers.get("x-idempotency-key");
  if (isValidIdempotencyKey(supplied)) {
    return supplied;
  }
  return ulid();
}

/** Standalone ULID generator for cases where there is no incoming request. */
export function newRequestId(): string {
  return ulid();
}
