import { z } from "zod";

// Domain types for the analyze pipeline. All types are derived from Zod
// schemas so the same definitions drive both runtime validation and
// compile-time types — no drift between the two.
//
// The Zod schemas are the source of truth. TypeScript types are z.infer'd
// aliases below each schema. Existing callers that `import type { X }`
// are unaffected.

export const PROMPT_VERSION = "2.1.0";

// ── Primitives ───────────────────────────────────────────────────────────

export const VerdictSchema = z.enum(["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"]);
export type Verdict = z.infer<typeof VerdictSchema>;

// User-facing labels for each verdict tier. The internal enum stays SAFE
// because it's the API contract, but every surface should display this
// string. SAFE is deliberately "Stay alert" rather than anything that
// asserts the message is benign — Arthur is a heuristic system and
// missing a scam happens. The instruction-led label keeps the lowest
// tier defensible: we always told the user to stay alert.
export const VERDICT_LABEL: Record<Verdict, string> = {
  SAFE: "Stay alert",
  UNCERTAIN: "Uncertain",
  SUSPICIOUS: "Suspicious",
  HIGH_RISK: "Looks like a scam",
};

export const AnalysisModeSchema = z.enum(["text", "image", "qrcode"]);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;

export const PhoneRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type PhoneRiskLevel = z.infer<typeof PhoneRiskLevelSchema>;

// ── Nested value types ───────────────────────────────────────────────────

export const ScammerContactSchema = z.object({
  value: z.string(),
  context: z.string(),
});
export type ScammerContact = z.infer<typeof ScammerContactSchema>;

export const ScammerContactsSchema = z.object({
  phoneNumbers: z.array(ScammerContactSchema),
  emailAddresses: z.array(ScammerContactSchema),
});
export type ScammerContacts = z.infer<typeof ScammerContactsSchema>;

export const RedirectHopSchema = z.object({
  url: z.string(),
  statusCode: z.number(),
  latencyMs: z.number(),
});
export type RedirectHop = z.infer<typeof RedirectHopSchema>;

export const RedirectChainSchema = z.object({
  originalUrl: z.string(),
  finalUrl: z.string(),
  hops: z.array(RedirectHopSchema),
  hopCount: z.number(),
  isShortened: z.boolean(),
  hasOpenRedirect: z.boolean(),
  truncated: z.boolean(),
  error: z.string().optional(),
});
export type RedirectChain = z.infer<typeof RedirectChainSchema>;

export const PhoneLookupResultSchema = z.object({
  valid: z.boolean(),
  phoneNumber: z.string(),
  countryCode: z.string().nullable(),
  nationalFormat: z.string().nullable(),
  lineType: z.string().nullable(),
  carrier: z.string().nullable(),
  isVoip: z.boolean(),
  riskFlags: z.array(z.string()),
  riskScore: z.number(),
  riskLevel: PhoneRiskLevelSchema,
  callerName: z.string().nullable(),
  callerNameType: z.string().nullable(),
});
export type PhoneLookupResult = z.infer<typeof PhoneLookupResultSchema>;

export const InjectionCheckResultSchema = z.object({
  detected: z.boolean(),
  patterns: z.array(z.string()),
});
export type InjectionCheckResult = z.infer<typeof InjectionCheckResultSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

// In-app-browser referrer carried from the Web Share Target redirect to
// the analyze pipeline. The header detection happens in
// apps/web/app/share-target/route.ts; the value rides through as a
// `shared_inapp` query param and lands here once the form POSTs. Stage 0.5
// of Shop Guard wires this up so the Stage-0 measurement window can
// quantify what share of commerce-flagged volume arrives from social
// in-app browsers (target: ≥20% per docs/plans/shop-guard-v2.md §3).
export const ReferrerSourceSchema = z.enum([
  "instagram-inapp",
  "tiktok-inapp",
  "facebook-inapp",
  "whatsapp-inapp",
]);
export type ReferrerSource = z.infer<typeof ReferrerSourceSchema>;

// Shop Signal Stage 1 — compact verdict from the APIVoid Site
// Trustworthiness paid feed. Produced by getSiteTrustworthiness() in
// packages/scam-engine/src/providers/apivoid.ts and merged onto
// ShopSignal by the Inngest fan-out (#321). Optional so Stage-0 payloads
// (free-only, no paid call) validate unchanged. `verdict` here is the
// APIVoid signal in isolation — the final fused commerce verdict is the
// consumer's job, not this object's.
export const PaidProviderVerdictSchema = z.object({
  provider: z.literal("apivoid"),
  verdict: z.enum(["safe", "suspicious", "risky"]),
  /** APIVoid trust_score.result, 0-100 (higher = more trustworthy). */
  trustScore: z.number(),
  /** domain_blacklist.detections — count of blacklists flagging the host. */
  blacklistDetections: z.number(),
  /** Human-readable risk markers lifted from APIVoid's security_checks. */
  flags: z.array(z.string()),
  checkedAt: z.string(),
});
export type PaidProviderVerdict = z.infer<typeof PaidProviderVerdictSchema>;

// Shop Signal — Stage 0 of Shop Guard. Attached to AnalysisResult when the
// input looks commerce-shaped (a URL with a shopping TLD / Shopify or
// WooCommerce hint / cart-or-checkout path). Carries a free-only signal at
// Stage 0; Stage 1 adds `paidProviderVerdict` (APIVoid). The four-value
// Verdict mismatch with scam_reports.verdict (which allows only the three
// legacy values) is accepted as documented in docs/plans/shop-guard-v2.md
// §1 row 5; Shop Signal never writes back to scam_reports, so the
// constraint never fires.
export const ShopSignalSchema = z.object({
  isCommerce: z.literal(true),
  commerceFlags: z.array(z.string()),
  generatedAt: z.string(),
  referrerSource: ReferrerSourceSchema.optional(),
  paidProviderVerdict: PaidProviderVerdictSchema.optional(),
});
export type ShopSignal = z.infer<typeof ShopSignalSchema>;

// Commerce-flag tag → user-facing label. The tags themselves are produced
// by extractCommerceFlags() in packages/scam-engine/src/shop-signal.ts
// (COMMERCE_FLAG_TAXONOMY). This map is the shared label source so the web
// ResultCard and the extension popup render identical chip text. Unknown
// tags fall through to their raw kebab-case form in the renderer rather
// than being dropped — surfacing the unknown is better than silently
// hiding it.
export const COMMERCE_FLAG_LABELS: Record<string, string> = {
  "payid-scam": "PayID-shaped scam",
  "fake-payment-confirmation": "Fake payment confirmation",
  "overpayment-refund": "Overpayment refund scam",
  "off-platform-move": "Moves you off-platform",
  "relative-will-collect": "Buyer's relative collects",
  "implausible-discount": "Discount too good to be true",
  "domain-renewal-invoice": "Fake .com.au domain invoice",
  "stock-photo-product": "Stock-photo product listing",
  "fake-trust-badge": "Fake trust badge",
  "fake-australia-post": "Fake Australia Post notice",
  "urgent-purchase-pressure": "Urgent purchase pressure",
  "fake-reviews": "Suspicious reviews",
};

// ── Deep Shop Check — Stage 1 user-initiated enrichment ──────────────────
//
// The Deep Shop Check is a SEPARATE request from analyze: the user clicks
// "Run a deeper shop check" in the result card, which POSTs to
// /api/shop-check and polls GET /api/shop-check/[id]. None of these types
// go on AnalysisResult — the deep check never rides the analyze response.
// See docs/adr/0008-shop-signal-deep-check-user-initiated.md.

export const DomainAgeBandSchema = z.enum([
  "fresh", // < 30 days — strongest fake-shop tell
  "recent", // 30–90 days
  "established", // ≥ 90 days
  "unknown", // WHOIS unavailable / no created date
]);
export type DomainAgeBand = z.infer<typeof DomainAgeBandSchema>;

export const AbnStatusSchema = z.enum([
  "verified", // ABN displayed, on the ABR register, entity name matches
  "name-mismatch", // ABN displayed + registered, but the holder name doesn't match
  "unregistered", // ABN displayed but not found / inactive on the register
  "no-abn", // .au shop, no ABN displayed at all
  "unverified", // ABN couldn't be checked — page unreadable or the register lookup failed
  "not-applicable", // non-AU host — ABN display is not expected
]);
export type AbnStatus = z.infer<typeof AbnStatusSchema>;

export const ShopCheckStatusSchema = z.enum([
  "queued",
  "processing",
  "complete",
  "error",
]);
export type ShopCheckStatus = z.infer<typeof ShopCheckStatusSchema>;

// Overall concern band. Never "safe" — a heuristic shop check cannot
// assert legitimacy, only the absence of detected concerns.
export const ShopCheckBandSchema = z.enum([
  "low-concern",
  "some-concern",
  "high-concern",
]);
export type ShopCheckBand = z.infer<typeof ShopCheckBandSchema>;

export const ShopCheckDomainAgeSchema = z.object({
  band: DomainAgeBandSchema,
  ageDays: z.number().nullable(),
  createdDate: z.string().nullable(),
});
export type ShopCheckDomainAge = z.infer<typeof ShopCheckDomainAgeSchema>;

export const ShopCheckAbnSchema = z.object({
  status: AbnStatusSchema,
  abn: z.string().nullable(),
  entityName: z.string().nullable(),
});
export type ShopCheckAbn = z.infer<typeof ShopCheckAbnSchema>;

// The enrichment payload stored under `shop_checks.signal.deepCheck`.
// `status` is always present; the result fields land only when the
// Inngest enrichment completes.
export const ShopCheckEnrichmentSchema = z.object({
  status: ShopCheckStatusSchema,
  domainAge: ShopCheckDomainAgeSchema.optional(),
  abn: ShopCheckAbnSchema.optional(),
  paidProviderVerdict: PaidProviderVerdictSchema.optional(),
  compositeScore: z.number().min(0).max(100).optional(),
  band: ShopCheckBandSchema.optional(),
  errorMessage: z.string().optional(),
  evaluatedAt: z.string().optional(),
});
export type ShopCheckEnrichment = z.infer<typeof ShopCheckEnrichmentSchema>;

// The shape GET /api/shop-check/[id] returns to the client.
export const ShopCheckResultSchema = ShopCheckEnrichmentSchema.extend({
  id: z.string().uuid(),
  url: z.string().optional(),
});
export type ShopCheckResult = z.infer<typeof ShopCheckResultSchema>;

// ── AnalysisResult — Claude's output plus pipeline-attached metadata ─────

export const AnalysisResultSchema = z.object({
  verdict: VerdictSchema,
  confidence: z.number(),
  summary: z.string(),
  redFlags: z.array(z.string()),
  nextSteps: z.array(z.string()),
  scamType: z.string().optional(),
  impersonatedBrand: z.string().optional(),
  channel: z.string().optional(),
  scammerContacts: ScammerContactsSchema.optional(),
  redirects: z.array(RedirectChainSchema).optional(),
  phoneIntelligence: PhoneLookupResultSchema.optional(),
  // Token usage surfaced so callsites can emit cost telemetry.
  // Populated by analyzeWithClaude; absent on cached/mock paths.
  usage: UsageSchema.optional(),
  shopSignal: ShopSignalSchema.optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ── Input schemas per surface ────────────────────────────────────────────
//
// Each surface has its own input shape with slightly different limits.
// Phase 5's `buildAnalyze(variant, deps)` factory will compose these into
// a discriminated union keyed by `source`. For now they stand alone so
// existing route handlers can swap their inline Zod for a shared schema.

const MAX_IMAGE_BASE64_BYTES = 5_000_000;
const MAX_IMAGES_PER_REQUEST = 10;
const MAX_TEXT_LENGTH = 10_000;

/** Web `/api/analyze` input — text and/or image(s), optional mode. */
export const WebAnalyzeInputSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    /** Legacy single-image field — merged into `images` downstream. */
    image: z.string().max(MAX_IMAGE_BASE64_BYTES).optional(),
    images: z
      .array(z.string().max(MAX_IMAGE_BASE64_BYTES))
      .max(MAX_IMAGES_PER_REQUEST)
      .optional(),
    mode: AnalysisModeSchema.optional(),
    /**
     * Source surface the request originated from when the user landed via
     * the Web Share Target route. Populated by ScamChecker.tsx from the
     * `shared_inapp` query param (which share-target/route.ts sets after
     * sniffing the inbound Referer + User-Agent). Stage 0.5 of Shop Guard
     * — drives the mobile-share-share measurement in the Stage-0 window.
     */
    referrerSource: ReferrerSourceSchema.optional(),
  })
  .refine(
    (data) => data.text || data.image || (data.images && data.images.length > 0),
    { message: "Either text or image(s) is required" }
  );
export type WebAnalyzeInput = z.infer<typeof WebAnalyzeInputSchema>;

/** Extension `/api/extension/analyze` input — text only, non-empty. */
export const ExtensionAnalyzeInputSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});
export type ExtensionAnalyzeInput = z.infer<typeof ExtensionAnalyzeInputSchema>;

/** Bot input — text, optional region and images. Not surfaced over HTTP. */
export const BotAnalyzeInputSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  region: z.string().optional(),
  images: z.array(z.string()).max(MAX_IMAGES_PER_REQUEST).optional(),
});
export type BotAnalyzeInput = z.infer<typeof BotAnalyzeInputSchema>;

// ── Output schema — shared across surfaces ───────────────────────────────
//
// Subset of `AnalysisResult` actually returned to clients, plus
// pipeline-injected fields. Each surface may omit some fields.

export const AnalyzeOutputSchema = z.object({
  verdict: VerdictSchema,
  confidence: z.number(),
  summary: z.string(),
  redFlags: z.array(z.string()),
  nextSteps: z.array(z.string()),
  urlsChecked: z.number().optional(),
  maliciousURLs: z.number().optional(),
  countryCode: z.string().nullable().optional(),
  scamType: z.string().optional(),
  impersonatedBrand: z.string().optional(),
  channel: z.string().optional(),
  scammerContacts: ScammerContactsSchema.optional(),
  scammerUrls: z
    .array(
      z.object({
        url: z.string(),
        isMalicious: z.boolean(),
        sources: z.array(z.string()),
      })
    )
    .optional(),
  inputMode: AnalysisModeSchema.optional(),
  redirects: z.array(RedirectChainSchema).optional(),
  phoneIntelligence: PhoneLookupResultSchema.optional(),
  phoneRiskFlags: z.array(z.string()).optional(), // backward compat
  isVoipCaller: z.boolean().optional(), // backward compat
  cached: z.boolean().optional(),
  shopSignal: ShopSignalSchema.optional(),
});
export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>;
