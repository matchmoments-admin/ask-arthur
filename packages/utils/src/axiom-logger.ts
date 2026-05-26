// Axiom logger wrapper — keeps ingest predictable and adds Ask Arthur context.
//
// Why this wrapper exists rather than using `new Logger()` directly:
//
// 1. Master kill switch. `FF_AXIOM_ENABLED=false` (or unset) makes the
//    logger a no-op so we can ship the wiring before the dashboards exist
//    and turn it on with a single env flip. The flag is server-side so
//    it uses the bracket-notation pattern from feature-flags.ts to defeat
//    Next.js build-time inlining of encrypted Vercel env vars.
//
// 2. Per-request sampling — not per log call. The spec proposed
//    `Math.random() < SAMPLE_PCT` per `info()` invocation, which would
//    keep half of a request's lines and drop the other half, breaking
//    traces. Instead we hash the requestId once and the whole request
//    is either in or out. WARN and ERROR always ship.
//
// 3. Defensive fall-back. If token/dataset env vars are missing the
//    wrapper degrades to a no-op rather than letting `next-axiom` raise.
//    Matches the existing `logger.ts` "never throw, just console" shape.

import { Logger } from "next-axiom";

function isAxiomEnabled(): boolean {
  return (process.env["FF_AXIOM_ENABLED"] ?? "").trim() === "true";
}

function samplePct(): number {
  const raw = process.env["AXIOM_SAMPLE_PCT"];
  if (raw && raw.trim().length > 0) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return process.env.NODE_ENV === "production" ? 10 : 100;
}

// FNV-1a 32-bit hash → deterministic 0..99 bucket from requestId.
// Same requestId always lands in the same bucket, so every log line for
// a given request is either kept or dropped together.
function bucketFromRequestId(requestId?: string): number {
  if (!requestId) return 0;
  let h = 2166136261;
  for (let i = 0; i < requestId.length; i++) {
    h ^= requestId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

export type AxiomSource =
  | "middleware"
  | "api/analyze"
  | "api/extension"
  | "api/webhooks"
  | "api/v1/threats"
  | "api/v1/intel"
  | "api/cron"
  | "inngest"
  | "scraper"
  | (string & Record<never, never>);

export interface AxiomLogContext {
  source: AxiomSource;
  requestId?: string;
  [key: string]: unknown;
}

export interface AxiomLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

const NOOP: AxiomLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: async () => {},
};

export function getLogger(ctx: AxiomLogContext): AxiomLogger {
  if (!isAxiomEnabled()) return NOOP;

  const token =
    process.env["NEXT_PUBLIC_AXIOM_TOKEN"] ?? process.env["AXIOM_TOKEN"];
  const dataset =
    process.env["NEXT_PUBLIC_AXIOM_DATASET"] ?? process.env["AXIOM_DATASET"];
  if (!token || !dataset) return NOOP;

  const bucket = bucketFromRequestId(ctx.requestId);
  const keepInfo = bucket < samplePct();

  const { source, requestId, ...extra } = ctx;

  const logger = new Logger({
    source,
    args: {
      env: process.env["VERCEL_ENV"] ?? process.env.NODE_ENV ?? "local",
      region: process.env["VERCEL_REGION"] ?? "unknown",
      requestId,
      ...extra,
    },
  });

  return {
    debug: (msg, fields) => {
      if (keepInfo) logger.debug(msg, fields);
    },
    info: (msg, fields) => {
      if (keepInfo) logger.info(msg, fields);
    },
    warn: (msg, fields) => logger.warn(msg, fields),
    error: (msg, fields) => logger.error(msg, fields),
    flush: () => logger.flush(),
  };
}
