/**
 * Content for /admin/showcase — the portfolio walk-through page.
 *
 * Fully static by design: this file is the ONLY data source for the page.
 * No DB reads, no fetches. Numbers are hand-verified against
 * docs/system-map/ + the tree; re-verify and bump `lastUpdated` when editing.
 * Diagram coordinates are hand-tuned in the 1200x720 viewBox.
 *
 * Guard rail: apps/web/__tests__/showcaseData.test.ts checks referential
 * integrity (edge endpoints, cluster ids, viewBox bounds, deep-link shape).
 */

export type ClusterId = "entry" | "engine" | "workers" | "platform";

export interface ShowcaseCluster {
  id: ClusterId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NodeStatus = "live" | "dark" | "mothballed";

export interface ShowcaseNode {
  /** Slug; doubles as the URL hash for deep-linking (#analyze-engine). */
  id: string;
  title: string;
  /** One-liner rendered inside the diagram node. Keep under ~28 chars. */
  tagline: string;
  cluster: ClusterId;
  x: number;
  y: number;
  w?: number;
  h?: number;
  status?: NodeStatus;
  features: string[];
  techStack: string[];
  deepLink?: { href: string; label: string };
  codeSnippet?: { lang: "ts" | "tsx" | "sql" | "python" | "bash"; title: string; code: string };
  engineeringNotes: string[];
}

export type EdgeKind = "event" | "http" | "cron" | "db";

export interface ShowcaseEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** Hand-tuned SVG path override; when absent the diagram routes a default quadratic. */
  d?: string;
  /** Spine edges keep the idle flow animation; everything else animates only when its node is active. */
  alwaysFlow?: boolean;
}

export interface ShowcaseStat {
  value: string;
  label: string;
}

export interface TechStripItem {
  name: string;
  category: "language" | "frontend" | "backend" | "data" | "infra" | "ai" | "ops";
}

export const VIEWBOX = { w: 1200, h: 720 } as const;
export const NODE_W = 176;
export const NODE_H = 54;

export const LAST_UPDATED = "2026-08-27";

export const STATS: ShowcaseStat[] = [
  { value: "75", label: "Inngest functions" },
  { value: "291", label: "DB migrations" },
  { value: "177", label: "Postgres RPCs" },
  { value: "23", label: "Python scrapers" },
  { value: "120", label: "API routes" },
  { value: "~80", label: "Feature flags" },
];

export const CLUSTERS: ShowcaseCluster[] = [
  { id: "entry", label: "ENTRY POINTS", x: 16, y: 20, w: 1168, h: 122 },
  { id: "engine", label: "ANALYSIS ENGINE", x: 16, y: 186, w: 1168, h: 122 },
  { id: "workers", label: "BACKGROUND WORKERS", x: 16, y: 352, w: 1168, h: 122 },
  { id: "platform", label: "PLATFORM FOUNDATION", x: 16, y: 518, w: 1168, h: 122 },
];

export const NODES: ShowcaseNode[] = [
  // ── entry ──────────────────────────────────────────────────────────────
  {
    id: "web-app",
    title: "Web App",
    tagline: "Next.js 16 · React 19",
    cluster: "entry",
    x: 34,
    y: 56,
    w: 188,
    status: "live",
    features: [
      "~30 consumer surfaces: Scam Checker, Image / Document / Charity Check, Scam Feed with world map, public Clone Watch reports, blog",
      "RSC-first data fetching — client components only at interaction leaves",
      "Admin subtree is force-dynamic behind middleware (Supabase admin role OR HMAC cookie) plus a per-page requireAdmin() check",
      "First-party analytics: write-once attribution cookie set in middleware, metadata-only event store",
    ],
    techStack: ["Next.js 16", "React 19", "Tailwind 4", "Vercel"],
    deepLink: { href: "/admin/analytics", label: "Open /admin/analytics" },
    codeSnippet: {
      lang: "ts",
      title: "middleware.ts — auth can degrade, the site cannot",
      code: `// A hung auth backend must not 504 every request (25s middleware cap).
const user = await withTimeout(supabase.auth.getUser(), 3_000);
// timeout -> treat as anonymous; route protection redirects if needed`,
    },
    engineeringNotes: [
      "Middleware auth is Promise.race-capped at 3s — a degraded Supabase Auth degrades protected pages only, never the whole site",
      "Turborepo remote cache: the PR preview build warms the exact tree the squash-merge deploys, so prod deploys replay cache",
    ],
  },
  {
    id: "extension",
    title: "Extension",
    tagline: "WXT MV3 · signed requests",
    cluster: "entry",
    x: 270,
    y: 56,
    w: 188,
    features: [
      "URL guard, Facebook ad scanning, right-click image check, Gmail + email-header analysis",
      "Non-extractable ECDSA P-256 identity generated on first run in IndexedDB",
      "Every API call signs METHOD, path, timestamp, nonce and body hash; ±5-min clock skew window",
      "One-shot Cloudflare Turnstile registration via an MV3 offscreen document",
    ],
    techStack: ["WXT", "React 19", "WebCrypto", "Turnstile"],
    deepLink: { href: "/extension", label: "Open /extension" },
    codeSnippet: {
      lang: "ts",
      title: "request signing — canonical string",
      code: `const canonical = [method, path, ts, nonce, sha256(body)].join("\\n");
const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(canonical));
// server: Upstash SETNX on the nonce -> replays rejected`,
    },
    engineeringNotes: [
      "Replay rejection is a single Redis SETNX — O(1) per request, no server-side session state",
      "Tier-aware rate limits (free 10/50 per day, pro 30/500) resolved from the Stripe-synced subscription",
    ],
  },
  {
    id: "mobile",
    title: "Mobile",
    tagline: "Expo 54 · attestation",
    cluster: "entry",
    x: 506,
    y: 56,
    w: 188,
    features: [
      "Share-intent scanning from any app, camera capture, push alerts",
      "Offline SQLite scam DB for on-device checks without a network round-trip",
      "SSL public-key pinning; Play Integrity / App Attest device attestation",
    ],
    techStack: ["Expo 54", "React Native", "expo-sqlite"],
    deepLink: { href: "/scan-channels", label: "Open /scan-channels" },
    engineeringNotes: [
      "Attestation gates the mobile API surface — a scripted client without a genuine device token gets a 403 before any paid work runs",
    ],
  },
  {
    id: "bots",
    title: "Chat Bots",
    tagline: "TG · WA · Slack · Messenger",
    cluster: "entry",
    x: 742,
    y: 56,
    w: 188,
    features: [
      "Four platforms, one shared analysis core and one outbound queue",
      "Per-platform formatters: Telegram HTML, WhatsApp markdown, Slack Block Kit, Messenger plain text",
      "Webhook signature verification on every inbound (HMAC / signing secret per platform)",
      "5 checks/hour sliding-window limit per bot user",
    ],
    techStack: ["@askarthur/bot-core", "pg_net", "Vonage", "grammY"],
    deepLink: { href: "/scan-channels", label: "Open /scan-channels" },
    codeSnippet: {
      lang: "sql",
      title: "queue dispatch — event-driven, zero polling",
      code: `-- Supabase DB webhook: INSERT on bot_message_queue fires pg_net
-- -> POST /api/bot-webhook (HMAC-signed). No poller, no idle cost;
-- a 10-min sweeper cron is the safety net, not the mechanism.`,
    },
    engineeringNotes: [
      "pg_net is unmetered on Supabase Pro — dispatch latency without a worker fleet or polling spend",
    ],
  },
  {
    id: "inbound-email",
    title: "Inbound Email",
    tagline: "CF Email Routing · Worker",
    cluster: "entry",
    x: 978,
    y: 56,
    w: 188,
    features: [
      "Tag-addressed intel sources: <tag>+ingest@ attributes each newsletter / regulator alert to its feed source",
      "MIME parsing in a Cloudflare Worker (postal-mime); GovDelivery / Mailchimp redirect wrappers resolved to real URLs",
      "scan@ lane: forward any suspicious email, get the verdict back by reply",
      "Admin quarantine surface promotes or discards ingested items",
    ],
    techStack: ["CF Email Routing", "Workers", "Edge Functions", "Resend"],
    deepLink: { href: "/admin/inbound-quarantine", label: "Open /admin/inbound-quarantine" },
    engineeringNotes: [
      "Email subscriptions replaced RSS scrapes that upstream WAFs blackholed (ACSC blocks GitHub-runner IPs) — same feed_items sink, sturdier transport",
    ],
  },

  // ── engine ─────────────────────────────────────────────────────────────
  {
    id: "security-scanners",
    title: "Security Scanners",
    tagline: "site / ext / MCP / skill",
    cluster: "engine",
    x: 130,
    y: 222,
    w: 220,
    features: [
      "Four scanners, one UnifiedScanResult contract: letter grade A+–F with per-check severity",
      "Website posture, Chrome-extension static analysis, MCP server audit, AI-skill audit",
      "Site audit streams progress over SSE — no long-poll, no job table",
    ],
    techStack: ["@askarthur/site-audit", "extension-audit", "mcp-audit", "SSE"],
    deepLink: { href: "/scan-channels", label: "Open /scan-channels" },
    engineeringNotes: [
      "One result schema across four scanners means every future surface (API, extension, report PDF) renders them for free",
    ],
  },
  {
    id: "analyze-engine",
    title: "Analyze Engine",
    tagline: "Claude Haiku 4.5 · verdicts",
    cluster: "engine",
    x: 470,
    y: 222,
    w: 260,
    status: "live",
    features: [
      "12-stage request path: IP extract → idempotency ULID → Zod validation → two-tier rate limit → injection detection → Redis cache → Safe Browsing + redirect chain → parallel Claude + URL reputation → verdict merge → async fan-out",
      "14 NFKC-normalised prompt-injection patterns; PII scrubbed before any persistence",
      "Three-layer idempotency: Idempotency-Key header → Inngest 24h event dedup → Postgres ON CONFLICT",
      "Verdict merge escalates on flagged URLs, injection and deepfake signals — SAFE / SUSPICIOUS / HIGH_RISK",
    ],
    techStack: ["Route Handler", "Zod 4", "Claude Haiku 4.5", "Upstash Redis", "Inngest"],
    deepLink: { href: "/admin/checks", label: "Open /admin/checks" },
    codeSnippet: {
      lang: "ts",
      title: "idempotency — same key in, same result out",
      code: `const id = req.headers.get("Idempotency-Key") ?? ulid();
await inngest.send({ id, name: "analyze.completed.v1", data });
// -> scam_reports.idempotency_key ON CONFLICT DO NOTHING`,
    },
    engineeringNotes: [
      "Durable consumers own all post-verdict writes — the request path stays O(1) DB round-trips",
      "Next: stream verdict tokens over SSE to cut TTFB on long scans",
    ],
  },
  {
    id: "intel-api",
    title: "Intel API",
    tagline: "B2B /api/v1 · OpenAPI",
    cluster: "engine",
    x: 850,
    y: 222,
    w: 220,
    features: [
      "~24 API-key-gated endpoints: URL / domain / wallet reputation, semantic scam search, Reddit intel themes, image + document check feeds",
      "OpenAPI 3.0 spec with a Scalar docs portal; self-service key rotation",
      "Per-call usage logging; tiers synced from Stripe subscriptions",
    ],
    techStack: ["Bearer keys", "OpenAPI 3", "Scalar", "pgvector"],
    deepLink: { href: "/app/developer", label: "Open /app/developer" },
    engineeringNotes: [
      "validateApiKey() centralises rate-limit + tier-limit + telemetry — a new endpoint is a handler plus one call, never a re-implementation",
    ],
  },

  // ── workers ────────────────────────────────────────────────────────────
  {
    id: "inngest",
    title: "Inngest",
    tagline: "75 durable functions",
    cluster: "workers",
    x: 27,
    y: 388,
    features: [
      "75 registered functions: event fan-outs, crons, retries and step-level durability",
      "Every function wrapped in withAxiomLogging; requestId idempotency keys throughout",
      "Production-only cron guard stops preview deployments double-firing prod schedules",
      "Fleet brake matrix documents the kill-switch for every function",
    ],
    techStack: ["Inngest", "Axiom", "feature_brakes"],
    deepLink: { href: "/admin/health", label: "Open /admin/health" },
    engineeringNotes: [
      "Operational reviews are distinct from correctness reviews: a re-submit path must move rows back across the exact predicate its retrieve stage filters on, or a loop is silently inert (learned the hard way — a recheck loop passed three correctness reviews while 81% dead)",
    ],
  },
  {
    id: "feed-scrapers",
    title: "Feed Scrapers",
    tagline: "23 Python · GHA cron",
    cluster: "workers",
    x: 221,
    y: 388,
    features: [
      "16+ threat feeds on a 4-tier cron (3h / 6h / 12h / daily): URLhaus, OpenPhish, PhishTank, Spamhaus, AbuseIPDB and friends",
      "AU regulator narratives: Scamwatch, ACSC, ASIC, AUSTRAC",
      "Feed health as data: roster + per-feed expectations live in feed_sources; a LEFT-JOIN view surfaces feeds that never succeeded",
      "Chunked writes ≤5K rows with a finite statement_timeout — every loop is retry-safe per chunk",
    ],
    techStack: ["Python", "GitHub Actions", "pytest"],
    deepLink: { href: "/admin/health", label: "Open /admin/health" },
    codeSnippet: {
      lang: "python",
      title: "hot-table write discipline",
      code: `for chunk in chunks(pks, 5_000):        # never one giant UPDATE
    try:
        cur.execute("SET statement_timeout = '300s'")  # finite, always
        cur.execute(TOUCH_SQL, (chunk,)); conn.commit()
    except Exception:
        conn.rollback()                  # one bad chunk != a dead run`,
    },
    engineeringNotes: [
      "Exit-code semantics page only on hard failures — an empty feed day is data, not an incident",
      "Born from a real incident: an uncapped statement_timeout let one UPDATE hang 20 hours and take the site down",
    ],
  },
  {
    id: "reddit-intel",
    title: "Reddit Intel",
    tagline: "classify → embed → cluster",
    cluster: "workers",
    x: 415,
    y: 388,
    features: [
      "Daily r/Scams pipeline: Sonnet classification (intent, modus operandi, impersonated brands) → Voyage embeddings → greedy centroid clustering at cosine ≥ 0.78",
      "PII-scrubbed ≤140-char quotes only — raw posts never persist",
      "Themes power the weekly digest email and the public /intel pages",
      "A$10/day cost brake checked before every Claude call",
    ],
    techStack: ["Sonnet 4.6", "Voyage 3", "pgvector IVFFlat"],
    deepLink: { href: "/admin/brand-candidates", label: "Open /admin/brand-candidates" },
    engineeringNotes: [
      "Greedy clustering beats k-means here: themes are open-ended and arrive as a stream, so centroid-assign-or-create needs no re-fit pass",
    ],
  },
  {
    id: "clone-watch",
    title: "Clone Watch",
    tagline: "NRD → urlscan → Netcraft",
    cluster: "workers",
    x: 609,
    y: 388,
    status: "live",
    features: [
      "~80K newly-registered domains/day swept lexically against the AU brand watchlist",
      "urlscan.io evidence per candidate: screenshot, effective URL, auto-classification",
      "Deterministic weaponisation-risk scorer ranks the monitoring tail for rescans",
      "Lifecycle state machine (detected → monitoring/weaponised → reported → taken_down) with a Postgres CHECK enforcing the invariant",
      "Netcraft submit + reconcile measures the vendor gap — the interval between a vendor 'no threat' and observed weaponisation",
    ],
    techStack: ["Inngest", "urlscan.io", "Netcraft v3", "RDAP"],
    deepLink: { href: "/admin/clone-watch", label: "Open /admin/clone-watch" },
    codeSnippet: {
      lang: "ts",
      title: "lifecycle — the spec is code, the DB enforces it",
      code: `// apps/web/lib/clone-watch/lifecycle.ts is the one spec;
// migration v288 mirrors it as a CHECK, so an illegal transition
// fails loudly in Postgres instead of drifting silently in prod.
assertTransition(alert.status, next); // TS side, same table`,
    },
    engineeringNotes: [
      "Witnessed-only metrics: vendor-gap durations count observed transitions, never backfills — the number survives due diligence",
    ],
  },
  {
    id: "onward-reporting",
    title: "Onward Reports",
    tagline: "per-destination fan-out",
    cluster: "workers",
    x: 803,
    y: 388,
    features: [
      "One routing brain (get_onward_destinations RPC) decides destinations from scam attributes — never duplicated per surface",
      "Per-destination Inngest workers: Scamwatch, ReportCyber, IDCARE, ACMA, OpenPhish, APWG, brand abuse",
      "Every attempt is one audit row, deduped on (report, destination, key)",
      "PII redacted before anything leaves the platform",
    ],
    techStack: ["Inngest", "Postgres RPC", "React Email"],
    deepLink: { href: "/admin/onward-reports", label: "Open /admin/onward-reports" },
    engineeringNotes: [
      "Adding a destination = an enum value + a worker + one key entry — the fan-out shape absorbs new regulators without route changes",
    ],
  },
  {
    id: "observability",
    title: "Observability",
    tagline: "brakes · watchdog · canary",
    cluster: "workers",
    x: 997,
    y: 388,
    features: [
      "cost_telemetry: one row per paid API call, tagged feature + provider; free tiers still log units at $0 so volume stays visible",
      "Self-pausing cost brakes: every paid operation checks its feature_brakes row before spending",
      "pg watchdog pages on any query ≥10 min and auto-terminates non-VACUUM backends at 60 min",
      "alert_delivery_log records the no-issue case too — a missing row means the alerter didn't run; a weekly synthetic canary proves the pager path",
    ],
    techStack: ["Postgres", "Telegram", "Axiom"],
    deepLink: { href: "/admin/costs", label: "Open /admin/costs" },
    codeSnippet: {
      lang: "ts",
      title: "the brake is checked before the spend, not after",
      code: `if (await isFeatureBraked("reddit_intel")) return skipped();
const res = await claude.messages.create(...);
await logCost({ feature: "reddit-intel", provider: "anthropic", ... });`,
    },
    engineeringNotes: [
      "Proof of life must not be conditional: a heartbeat gated on 'nothing to report' vanishes exactly when things get noisy",
      "Degradation must never read as health — count:null is a failed count, not zero",
    ],
  },

  // ── platform ───────────────────────────────────────────────────────────
  {
    id: "upstash",
    title: "Upstash",
    tagline: "Redis cache · rate limits",
    cluster: "platform",
    x: 27,
    y: 554,
    features: [
      "All rate limiting: two-tier per-IP analyze limits, bot and inbound-scan windows, extension nonce replay store",
      "Analysis result cache: composite versioned key, per-verdict TTL, PII-scrubbed values",
      "Fail-closed in production — Redis down means requests are limited, not unlimited",
    ],
    techStack: ["@upstash/ratelimit", "@upstash/redis"],
    engineeringNotes: [
      "Serverless-native Redis: per-request HTTP, no connection pool to exhaust from a function fleet",
    ],
  },
  {
    id: "stripe",
    title: "Stripe",
    tagline: "billing · event log",
    cluster: "platform",
    x: 221,
    y: 554,
    features: [
      "Checkout + customer portal + signature-verified webhook",
      "Idempotent stripe_event_log — a replayed webhook is a no-op, not a double-grant",
      "Subscription tier syncs into API-key tiers and per-product entitlements; AU GST via Stripe Tax",
    ],
    techStack: ["Stripe v22", "Stripe Tax"],
    engineeringNotes: [
      "Customer mapping lives server-side (user_profiles.stripe_customer_id); webhook metadata is cross-checked, never trusted",
    ],
  },
  {
    id: "supabase",
    title: "Supabase",
    tagline: "Postgres · RLS · pgvector",
    cluster: "platform",
    x: 415,
    y: 554,
    status: "live",
    features: [
      "77+ tables, 291 migrations, 177 RPCs (136 SECURITY DEFINER)",
      "RLS everywhere, hardened across four audit waves; SECURITY DEFINER RPCs are the only write path to hot tables",
      "pgvector policy: embeddings live on 1:1 sibling tables so HNSW churn never dirties hot-table writes",
      "Generated TypeScript types keep row shapes from drifting from migrations",
    ],
    techStack: ["Postgres 15", "pgvector", "pg_trgm", "pg_net"],
    deepLink: { href: "/admin/costs/infra", label: "Open /admin/costs/infra" },
    codeSnippet: {
      lang: "sql",
      title: "ADR-0005 — the sibling-table index policy",
      code: `-- Never put an HNSW on a write-hot table: every UPDATE dirties
-- index pages and burns disk-IO budget. Embeddings get a 1:1 sibling:
CREATE TABLE acnc_charity_embeddings (
  charity_id uuid PRIMARY KEY REFERENCES acnc_charities(id),
  embedding  vector(1024)
);  -- HNSW lives here; daily writes stay on the lean parent`,
    },
    engineeringNotes: [
      "Chunked ≤5K writes with finite statement_timeout on every hot-table loop — the discipline exists because its absence caused a 20-hour outage",
    ],
  },
  {
    id: "voyage",
    title: "Voyage",
    tagline: "1024-dim embeddings",
    cluster: "platform",
    x: 609,
    y: 554,
    features: [
      "voyage-3 embeddings across five corpora: scam reports, verified scams, Reddit narratives, regulator feeds, 63,637 ACNC charities",
      "Partial HNSW / IVFFlat indexes — only rows with embeddings pay the index cost",
      "Hybrid retrieval: BM25 + vector rerank for semantic scam search",
    ],
    techStack: ["Voyage 3", "pgvector HNSW"],
    engineeringNotes: [
      "ef_search tuned to 80 for 0.98 recall@10 — measured, not defaulted",
    ],
  },
  {
    id: "resend",
    title: "Resend",
    tagline: "React Email templates",
    cluster: "platform",
    x: 803,
    y: 554,
    features: [
      "All transactional + intel email under one Editorial Briefing layout: weekly digest, clone-watch brand alerts, scan replies",
      "Idempotency keys on every send — retries never double-deliver",
      "Email Studio: admin preview of every template with DB-backed editable copy slots and test-send-to-self",
    ],
    techStack: ["Resend", "React Email"],
    deepLink: { href: "/admin/email-studio", label: "Open /admin/email-studio" },
    engineeringNotes: [
      "Copy lives in the DB, layout in code — marketing edits don't require a deploy, structure can't be broken from a textarea",
    ],
  },
  {
    id: "axiom",
    title: "Axiom",
    tagline: "logs · 10% sampling",
    cluster: "platform",
    x: 997,
    y: 554,
    features: [
      "Structured logs from every Inngest function and API route",
      "FNV-1a per-request sampling: 10% of INFO/DEBUG in prod, WARN/ERROR always ship — a request's logs are kept or dropped together",
      "Rare high-value events use always-ship warn, bypassing sampling",
    ],
    techStack: ["Axiom", "next-axiom"],
    engineeringNotes: [
      "Request-coherent sampling means a kept trace is a complete trace — 10% cost, 100% debuggability per kept request",
    ],
  },
];

export const EDGES: ShowcaseEdge[] = [
  // entry -> engine (the request spine)
  { id: "web-analyze", from: "web-app", to: "analyze-engine", kind: "http", d: "M 128 110 C 220 170 480 168 500 216", alwaysFlow: true },
  { id: "ext-analyze", from: "extension", to: "analyze-engine", kind: "http", d: "M 364 110 C 420 160 536 172 548 216" },
  { id: "mob-analyze", from: "mobile", to: "analyze-engine", kind: "http", d: "M 600 110 L 600 218" },
  { id: "bots-analyze", from: "bots", to: "analyze-engine", kind: "http", d: "M 836 110 C 780 160 664 172 652 216" },
  { id: "api-analyze", from: "intel-api", to: "analyze-engine", kind: "http", d: "M 850 249 L 734 249" },
  // engine -> workers / platform
  { id: "analyze-inngest", from: "analyze-engine", to: "inngest", kind: "event", label: "analyze.completed.v1", d: "M 500 276 Q 250 330 122 385", alwaysFlow: true },
  { id: "analyze-upstash", from: "analyze-engine", to: "upstash", kind: "db", label: "cache · limits", d: "M 480 274 C 300 360 160 460 115 552" },
  // workers -> platform
  { id: "inngest-supabase", from: "inngest", to: "supabase", kind: "event", label: "scam_reports", d: "M 115 442 Q 200 515 452 551", alwaysFlow: true },
  { id: "inngest-axiom", from: "inngest", to: "axiom", kind: "http", d: "M 203 430 C 500 520 800 540 995 560" },
  { id: "scrapers-supabase", from: "feed-scrapers", to: "supabase", kind: "cron", label: "feed_items", d: "M 309 442 Q 340 502 456 548" },
  { id: "reddit-supabase", from: "reddit-intel", to: "supabase", kind: "cron", d: "M 503 442 L 503 550" },
  { id: "reddit-voyage", from: "reddit-intel", to: "voyage", kind: "http", d: "M 591 428 Q 668 488 690 549" },
  { id: "clone-supabase", from: "clone-watch", to: "supabase", kind: "cron", d: "M 697 442 Q 640 502 553 549" },
  { id: "onward-resend", from: "onward-reporting", to: "resend", kind: "event", d: "M 891 442 L 891 550" },
  { id: "obs-axiom", from: "observability", to: "axiom", kind: "http", d: "M 1085 442 L 1085 550" },
  // entry -> platform
  { id: "inbound-supabase", from: "inbound-email", to: "supabase", kind: "http", label: "feed_items", d: "M 1072 110 C 1230 260 810 460 580 551" },
  { id: "bots-supabase", from: "bots", to: "supabase", kind: "db", label: "pg_net", d: "M 900 110 C 990 260 700 460 590 545" },
  { id: "stripe-web", from: "stripe", to: "web-app", kind: "http", label: "webhooks", d: "M 240 554 C 60 480 30 260 40 112" },
];

export const TECH_STRIP: TechStripItem[] = [
  { name: "TypeScript", category: "language" },
  { name: "Python", category: "language" },
  { name: "SQL / PL-pgSQL", category: "language" },
  { name: "Next.js 16", category: "frontend" },
  { name: "React 19", category: "frontend" },
  { name: "Tailwind 4", category: "frontend" },
  { name: "WXT (MV3)", category: "frontend" },
  { name: "Expo 54", category: "frontend" },
  { name: "pnpm + Turborepo", category: "infra" },
  { name: "Vercel", category: "infra" },
  { name: "Cloudflare Workers", category: "infra" },
  { name: "GitHub Actions", category: "infra" },
  { name: "Supabase", category: "data" },
  { name: "pgvector", category: "data" },
  { name: "Upstash Redis", category: "data" },
  { name: "Inngest", category: "backend" },
  { name: "Stripe", category: "backend" },
  { name: "Resend", category: "backend" },
  { name: "Anthropic", category: "ai" },
  { name: "Voyage AI", category: "ai" },
  { name: "Hive AI", category: "ai" },
  { name: "Axiom", category: "ops" },
];

/** Adjacency helper — node id -> the edge ids and node ids it lights up. */
export function buildAdjacency(): Map<string, { edges: Set<string>; nodes: Set<string> }> {
  const adj = new Map<string, { edges: Set<string>; nodes: Set<string> }>();
  for (const node of NODES) adj.set(node.id, { edges: new Set(), nodes: new Set() });
  for (const edge of EDGES) {
    adj.get(edge.from)?.edges.add(edge.id);
    adj.get(edge.from)?.nodes.add(edge.to);
    adj.get(edge.to)?.edges.add(edge.id);
    adj.get(edge.to)?.nodes.add(edge.from);
  }
  return adj;
}
