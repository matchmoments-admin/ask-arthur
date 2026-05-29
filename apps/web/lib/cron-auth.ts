import { timingSafeEqual } from "node:crypto";

/**
 * Validates the `Authorization: Bearer <CRON_SECRET>` header that Vercel Cron
 * auto-attaches to scheduled invocations.
 *
 * Returns a 401 `Response` when the request is unauthorized, or `null` when it
 * is authorized — call as:
 *
 *   const unauthorized = requireCronAuth(req);
 *   if (unauthorized) return unauthorized;
 *
 * Fails CLOSED when `CRON_SECRET` is unset (the `!expected` guard). A missing
 * secret MUST reject, never authorize the literal string `"Bearer undefined"`.
 *
 * Born from the /ultracode audit (2026-05-30): `weekly-email`, `weekly-blog`
 * and `pipeline-health` compared against `` `Bearer ${process.env.CRON_SECRET}` ``
 * with no `!expected` guard, so an unset secret authorized `Bearer undefined`;
 * `nurture` wrapped the check in `if (cronSecret)` and skipped auth entirely.
 * Centralising the check here is the single source of truth that prevents that
 * drift class from recurring. The compare is length-checked + timing-safe per
 * the project's secret-comparison rule.
 */
export function requireCronAuth(req: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!expected || !authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const provided = Buffer.from(authHeader);
  const expectedHeader = Buffer.from(`Bearer ${expected}`);
  if (
    provided.length !== expectedHeader.length ||
    !timingSafeEqual(provided, expectedHeader)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
