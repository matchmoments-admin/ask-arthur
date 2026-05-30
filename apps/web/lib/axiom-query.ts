import { logger } from "@askarthur/utils/logger";

// Read-side helper for Axiom (the ingest side is next-axiom + the gated
// getLogger wrapper). Used by the axiom-fleet-watch cron to poll the
// `ask-arthur` dataset for runaway/error conditions. Needs a QUERY-scoped
// Axiom token in `AXIOM_QUERY_TOKEN` (distinct from NEXT_PUBLIC_AXIOM_TOKEN,
// which is ingest-only). Degrades to null when unset so the watchdog no-ops
// rather than throwing — it is best-effort, never a request path.

const AXIOM_APL_URL = "https://api.axiom.co/v1/datasets/_apl?format=tabular";

export type AxiomRow = Record<string, unknown>;

/**
 * Run an APL query over [startISO, endISO] and return result rows as plain
 * objects keyed by the result field names. Returns null on missing token /
 * non-OK response / network error (caller treats null as "couldn't check").
 */
export async function axiomQuery(
  apl: string,
  startISO: string,
  endISO: string,
): Promise<AxiomRow[] | null> {
  const token = process.env.AXIOM_QUERY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(AXIOM_APL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apl, startTime: startISO, endTime: endISO }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn("axiomQuery non-OK response", { status: res.status });
      return null;
    }
    const data = (await res.json()) as {
      tables?: Array<{
        fields?: Array<{ name: string }>;
        columns?: unknown[][];
      }>;
    };
    const table = data.tables?.[0];
    if (!table?.fields || !table.columns) return [];
    const names = table.fields.map((f) => f.name);
    const cols = table.columns;
    const rowCount = cols[0]?.length ?? 0;
    const rows: AxiomRow[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: AxiomRow = {};
      names.forEach((name, c) => {
        row[name] = cols[c]?.[i];
      });
      rows.push(row);
    }
    return rows;
  } catch (err) {
    logger.warn("axiomQuery failed", { error: String(err) });
    return null;
  }
}
