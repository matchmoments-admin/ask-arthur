import { z } from "zod";

// Domain types for the analyze pipeline. All types are derived from Zod
// schemas so the same definitions drive both runtime validation and
// compile-time types — no drift between the two.
//
// The Zod schemas are the source of truth. TypeScript types are z.infer'd
// aliases below each schema. Existing callers that `import type { X }`
// are unaffected.

export const PROMPT_VERSION = "2.0.0";

// ── Primitives ───────────────────────────────────────────────────────────

export const VerdictSchema = z.enum(["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"]);
export type Verdict = z.infer<typeof VerdictSchema>;

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
});
export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>;
