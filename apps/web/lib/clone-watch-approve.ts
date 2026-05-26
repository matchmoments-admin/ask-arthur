import crypto from "crypto";

// HMAC-signed approval URLs for clone-watch brand-notification batches.
// Mirrors the apps/web/lib/unsubscribe.ts pattern: SHA-256 HMAC over the
// canonical message, hex-encoded, timing-safe verify.
//
// Same secret tier (ADMIN_SECRET fallback). A leaked URL only allows
// approving / rejecting ONE specific batch_id, not impersonating the
// admin generally.

function getSecret(): string {
  const secret =
    process.env.CLONE_WATCH_APPROVAL_SECRET ?? process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error(
      "CLONE_WATCH_APPROVAL_SECRET / ADMIN_SECRET not configured",
    );
  }
  return secret;
}

export type BatchAction = "approve" | "reject";

/** Canonical message that gets signed — locked to (action, batchId, brand,
 *  recipient) so a leaked approve URL can't be repurposed to approve a
 *  DIFFERENT batch by swapping the path segment. */
function canonicalMessage(
  action: BatchAction,
  batchId: string,
  brand: string,
  recipient: string,
): string {
  return [action, batchId, brand.toLowerCase(), recipient.toLowerCase()].join(
    "|",
  );
}

export function signBatchApproveToken(
  action: BatchAction,
  batchId: string,
  brand: string,
  recipient: string,
): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(canonicalMessage(action, batchId, brand, recipient))
    .digest("hex");
}

export function verifyBatchApproveToken(
  action: BatchAction,
  batchId: string,
  brand: string,
  recipient: string,
  token: string,
): boolean {
  try {
    const expected = signBatchApproveToken(action, batchId, brand, recipient);
    return crypto.timingSafeEqual(
      Buffer.from(token, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

/** Build the full approve / reject URL for inclusion in the Telegram preview. */
export function buildBatchApprovalUrl(
  action: BatchAction,
  batchId: string,
  brand: string,
  recipient: string,
  base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au",
): string {
  const sig = signBatchApproveToken(action, batchId, brand, recipient);
  const params = new URLSearchParams({
    brand,
    recipient,
    sig,
  });
  return `${base}/api/admin/clone-watch/${action}-batch/${batchId}?${params.toString()}`;
}
