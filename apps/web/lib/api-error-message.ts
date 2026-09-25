/**
 * The user-facing text of a failed API response body. API routes return
 * `{ error }` and some also `{ message }`; clients that read only `message`
 * showed a generic fallback for every specific failure (e.g. a skill "too
 * large to assess").
 */
export function apiErrorMessage(body: unknown, fallback = "Scan failed"): string {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.error === "string" && b.error) return b.error;
  }
  return fallback;
}
