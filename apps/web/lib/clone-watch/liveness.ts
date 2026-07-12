/**
 * Clone-watch liveness probing — shared by auto-triage (confirm a clone is
 * still serving before auto-confirming) and the Netcraft issue reporter
 * (never spend a one-per-submission issue slot on a dead site).
 *
 * Moved verbatim from clone-watch-auto-triage.ts (F3); auto-triage re-exports
 * so its callers and tests are unchanged.
 */

const LIVENESS_TIMEOUT_MS = 8_000;

/**
 * Liveness probe: is the candidate URL still serving? "Live" = any HTTP
 * response < 500 within the timeout (a 401/403/404 still means the host is up;
 * a taken-down clone usually fails DNS/connection or 5xxs). Never throws.
 */
export async function isCandidateLive(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVENESS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "AskArthur-CloneWatch/1.0 (+https://askarthur.au)" },
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a batch of URLs with bounded concurrency; duplicates are probed once.
 * Returns url → live. Never throws (per-URL failures read as dead).
 */
export async function probeLiveness(
  urls: string[],
  concurrency = 4,
): Promise<Map<string, boolean>> {
  const unique = [...new Set(urls)];
  const out = new Map<string, boolean>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, unique.length) },
    async () => {
      while (cursor < unique.length) {
        const url = unique[cursor++];
        out.set(url, await isCandidateLive(url));
      }
    },
  );
  await Promise.all(workers);
  return out;
}
