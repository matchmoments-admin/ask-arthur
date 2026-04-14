# Grant Applications — Ask Arthur

*Drafted April 2026*

Two complete applications: (1) R&D Tax Incentive (RDTI) FY24-25, and (2) Startmate Accelerator.

---

## APPLICATION 1: R&D TAX INCENTIVE (RDTI) — FY24-25

**WARNING: Registration deadline is 30 April 2026. File immediately.**

**Entity:** Ask Arthur Pty Ltd
**ABN:** [INSERT ABN]
**Financial year:** 1 July 2024 -- 30 June 2025
**Offset rate:** 43.5% refundable (turnover < $20M)

---

### 1. Core R&D Activities

*(~650 words)*

Ask Arthur conducts systematic, investigative, and experimental R&D activities to generate new knowledge in the application of AI to real-time scam detection at consumer scale. The following core activities involve technical uncertainty that could not be resolved by a competent professional using existing knowledge, information, or experience.

**Core Activity 1: Adversarial-Resistant AI Classification Pipeline**

The core technical hypothesis was: can a large language model (Claude Haiku) be reliably used for real-time scam classification when adversaries actively attempt to manipulate the model's outputs via prompt injection?

This is not routine use of an off-the-shelf LLM. The activity involved:

- Designing a multi-layered prompt injection defence system combining input sanitisation (Unicode stripping of 10+ invisible character classes via `sanitizeUnicode()`), XML escaping of user input, cryptographic nonce delimiters to prevent delimiter breakout, and a 14-pattern regex pre-filter (`INJECTION_PATTERNS` in `packages/scam-engine/src/claude.ts`) [Data -- code exists in repository]
- Experimentally determining a confidence threshold (0.6) below which the model's verdict is downgraded to UNCERTAIN, through iterative testing against adversarial inputs [Data -- threshold constant in `claude.ts`]
- Developing a structured output schema that constrains Claude's response to a valid JSON envelope with typed fields (verdict, confidence, redFlags, scamType, channel, scammerContacts), reducing hallucination surface area [Data -- Zod schema in `@askarthur/types`]
- Iterating prompt engineering across multiple PROMPT_VERSION increments to balance classification accuracy against adversarial robustness [Data -- version tracked in `@askarthur/types`]

The technical uncertainty was whether prompt injection defences could be made robust enough for a consumer-facing product where every input is untrusted and adversaries have economic incentive to bypass detection. This could not be determined in advance -- it required systematic experimentation. [Assumption -- novelty claim; no prior published system combines these specific defences for scam classification]

**Core Activity 2: Multi-Signal Entity Risk Scoring Algorithm**

The hypothesis was: can community-sourced scam reports be combined with heterogeneous external intelligence sources to produce a reliable composite risk score (0--100) for entities (URLs, phone numbers, emails, IPs, domains, crypto wallets, bank accounts)?

Activities included:

- Designing a composite risk scoring algorithm (`compute_entity_risk_score` PostgreSQL RPC, migration v27) that weights report frequency, source diversity, temporal decay, enrichment signals (WHOIS age, SSL validity, abuse reports, breach exposure, VoIP status), and entity type [Data -- SQL RPC in `supabase/` migrations]
- Building a two-tier enrichment pipeline (`packages/scam-engine/src/inngest/entity-enrichment.ts`): Tier 1 runs 5 external API checks in parallel via `Promise.allSettled` (AbuseIPDB, HIBP, crt.sh, Twilio Lookup, IPQualityScore); Tier 2 runs async URLScan.io submissions with polling. One failure never blocks others [Data -- code exists]
- Developing a union-find clustering algorithm (`packages/scam-engine/src/inngest/cluster-builder.ts`) to group related scam reports into campaigns via shared entities, using path compression and union by rank [Data -- code exists]
- Experimentally calibrating enrichment point caps (raised from 25 to 40 after observing score compression in multi-source entities) [Data -- migration history shows iterative changes]

The technical uncertainty was what combination and weighting of heterogeneous signals would produce risk scores that meaningfully distinguish true scam infrastructure from false positives, particularly for entities with sparse report histories. [Assumption -- no published scoring methodology combines these specific signals for Australian scam entities]

**Core Activity 3: Privacy-Preserving Community Intelligence Pipeline**

The hypothesis was: can a PII-scrubbing pipeline reliably strip personally identifiable information from free-text scam submissions while preserving enough semantic content for threat intelligence value?

Activities included:

- Developing a 12-pattern ordered PII scrubbing pipeline (`scrubPII()` in `packages/scam-engine/src/pipeline.ts`) where pattern ordering is critical -- credit card, Medicare, and TFN patterns must execute before the generic phone pattern, which is greedy and would consume their digit sequences [Data -- code with ordering comments exists]
- Post-scrub cleanup pass to catch residual name/username fragments attached to email placeholders [Data -- regex in `pipeline.ts`]
- Defence-in-depth approach: PII scrubbing at the application layer combined with Claude system prompt instructions to never reconstruct redacted information [Data -- system prompt in `claude.ts`]

The technical uncertainty was whether regex-based PII scrubbing could achieve sufficient recall across the diversity of Australian PII formats (TFN, Medicare, BSB, AU phone formats) without destroying the scam-relevant content. [Assumption -- claimed as novel for Australian-specific formats in scam context]

**Eligible vs Ineligible Examples from Codebase:**

| Codebase Component | Eligible? | Reason |
|---|---|---|
| `INJECTION_PATTERNS` (14 regex patterns in `claude.ts`) | YES | Experimental -- patterns iteratively developed against adversarial inputs |
| `scrubPII()` ordered pipeline (`pipeline.ts`) | YES | Novel -- ordering sensitivity and Australian-specific formats required experimentation |
| `compute_entity_risk_score` RPC (v27 migration) | YES | Novel algorithm -- signal weighting required experimentation |
| `UnionFind` cluster builder (`cluster-builder.ts`) | YES | Applied research -- adapting graph algorithms to scam campaign detection |
| `ct-monitor.ts` (Certificate Transparency monitoring) | YES | Novel application -- brand impersonation detection via CT logs |
| `local-intel.ts` (DNS + libphonenumber enrichment) | YES | Experimental -- determining which free signals have predictive value |
| Standard Next.js pages and UI components | NO | Routine software development |
| Paddle billing integration | NO | Off-the-shelf integration, no technical uncertainty |
| Plausible analytics setup | NO | Configuration of existing tool |
| Blog system with categories | NO | Standard content management, no experimentation |
| Vercel deployment configuration | NO | Routine DevOps |
| Newsletter subscription (Resend) | NO | Standard API integration |

---

### 2. Supporting R&D Activities

*(~350 words)*

The following activities directly support the core R&D activities and would not have been conducted absent the core activities.

**Supporting Activity 1: Threat Feed Ingestion Framework**

A Python scraper framework (`pipeline/scrapers/`) with 16 integrations (PhishTank, URLhaus, ThreatFox, OpenPhish, Spamhaus, AbuseIPDB, CERT Australia, Scamwatch RSS, and 8 others) provides the ground-truth training and validation data against which the risk scoring algorithm (Core Activity 2) is calibrated. The shared `common/` library handles URL normalisation, database operations, validation, and R2 evidence storage. [Data -- 16 Python scraper files exist in repository]

Without this feed infrastructure, the risk scoring algorithm would have no external validation signal and could not be experimentally tuned.

**Supporting Activity 2: Deep Investigation Pipeline**

Weekly automated passive reconnaissance on CRITICAL/HIGH risk entities using 6 security tools (nmap, dnsrecon, nikto, whatweb, sslscan, whois) stored as JSONB in `scam_entities.investigation_data` (migration v28). This pipeline generates ground-truth labels for validating the risk scoring algorithm's outputs -- if the deep investigation confirms malicious infrastructure (bulletproof hosting, expired SSL, exposed admin panels), the risk score should have already flagged the entity as high-risk. [Data -- GitHub Actions workflow + Python investigation script exist]

**Supporting Activity 3: Inngest Background Processing Infrastructure**

Eleven event-driven background functions orchestrate the enrichment, scoring, clustering, and staleness management that the core R&D activities depend on. The functions implement automated staleness detection (marking entities inactive after 7--14 days), WHOIS+SSL enrichment fan-out (every 6 hours), and Certificate Transparency monitoring (every 12 hours). [Data -- function definitions in `packages/scam-engine/src/inngest/`]

**Supporting Activity 4: Cross-Platform Bot Analysis Engine**

The shared `@askarthur/bot-core` package adapts the core analysis pipeline for 4 chat platforms (Telegram, WhatsApp, Slack, Messenger) with platform-specific formatting. This supports Core Activity 1 by expanding the volume and diversity of adversarial inputs the injection defence system must handle -- bot users submit raw forwarded messages that exhibit different prompt injection vectors than web form submissions. [Data -- `packages/bot-core/` exists]

---

### 3. Technical Uncertainty

*(~400 words)*

The following technical uncertainties could not be resolved by a competent professional in advance of conducting the experimental activities. These are not commercial or implementation uncertainties.

**Uncertainty 1: Adversarial robustness of LLM-based scam classification**

It was not known whether a large language model could be made reliably resistant to prompt injection in a consumer-facing scam detection context where every input is untrusted. Published research on prompt injection defence (Perez & Ribeiro 2022, Greshake et al. 2023) demonstrates that no defence is provably complete. The specific question -- whether a combination of Unicode sanitisation, nonce delimiters, regex pre-filtering, and confidence thresholding would achieve acceptable false-negative rates against motivated adversaries -- could only be answered through systematic experimentation. [Data -- 14 injection patterns represent the current state of this experimental iteration]

A competent software engineer could implement an LLM API call. The uncertainty was not "how to call Claude" but "how to make Claude's outputs trustworthy when the input is adversarially crafted." This is a qualitatively different problem that required generating new knowledge. [Assumption -- framing the novelty boundary]

**Uncertainty 2: Optimal signal combination for multi-source entity risk scoring**

It was not known what combination of report frequency, temporal decay, WHOIS domain age, SSL certificate validity, AbuseIPDB abuse confidence scores, HIBP breach counts, Certificate Transparency anomalies, Twilio VoIP detection, and IPQualityScore fraud scores would produce a composite risk score with acceptable discrimination between true scam infrastructure and benign entities. The search space is large (10+ heterogeneous signals with different scales, reliability levels, and update frequencies), and no published methodology addresses this specific signal combination for Australian scam entities. [Assumption -- novelty claim]

The enrichment point cap was experimentally adjusted from 25 to 40 after observing that multi-source entities had compressed scores, demonstrating that this required iterative experimentation rather than predetermined engineering. [Data -- migration history shows v27 initial implementation and subsequent adjustments]

**Uncertainty 3: PII scrubbing recall across Australian identity formats**

It was not known whether regex-based scrubbing could reliably detect Australian-specific PII formats (Tax File Numbers formatted as XXX XXX XXX, Medicare numbers as XXXX XXXXX X, BSB codes as XXX-XXX) within free-text scam submissions that contain irregular formatting, typos, and partial numbers. The critical technical question was the interaction between pattern ordering (greedy digit patterns consuming TFN/Medicare digits) and recall -- discovered experimentally and resolved through ordered pattern execution. [Data -- code comments in `pipeline.ts` document the ordering requirement]

---

### 4. New Knowledge Generated

*(~300 words)*

The R&D activities generated the following new knowledge that did not exist prior to the experiments:

**Knowledge 1: Layered prompt injection defence architecture for adversarial classification**

We established that a four-layer defence (Unicode sanitisation -> XML escaping -> nonce-delimited input boundaries -> regex pre-filter) combined with a 0.6 confidence threshold achieves usable robustness for consumer-facing scam classification. The key finding was that no single layer is sufficient -- Unicode sanitisation alone missed delimiter breakout attacks, regex pre-filtering alone missed novel injection phrasing, and confidence thresholding alone produced excessive false negatives. The combination of all four layers with the confidence floor was necessary and sufficient for production deployment. [Data -- defence layers visible in `claude.ts`; Estimate -- "usable robustness" based on observed production false-negative rate, not formally measured]

**Knowledge 2: Signal weighting for heterogeneous threat intelligence fusion**

We determined that report frequency and WHOIS domain age are the strongest discriminators in the composite risk score, while VoIP status and breach exposure are useful secondary signals. The enrichment cap of 40 points was experimentally derived. The union-find clustering with a 2-entity overlap threshold effectively groups related scam campaigns with acceptable precision. [Data -- scoring algorithm exists; Estimate -- relative signal importance based on informal evaluation, not published benchmarks]

**Knowledge 3: Ordered PII scrubbing is essential for Australian formats**

We discovered that Australian-specific PII formats create ordering dependencies in regex-based scrubbing that do not exist for US/EU formats. Specifically, the generic phone pattern (\d{3}[\s.-]?\d{4}) is greedy enough to consume partial TFN, Medicare, and credit card digit sequences. The solution -- executing more specific patterns first -- is simple but the problem was not foreseeable and required experimental discovery. [Data -- ordering comments in `pipeline.ts` created during development]

---

### 5. Experiment Methodology

*(~350 words)*

Each core R&D activity followed a hypothesis-driven experimental methodology:

**Activity 1 methodology (Adversarial classification):**

1. Hypothesis formulation: "Adding [specific defence layer] will reduce false-negative rate against [specific injection class] without increasing false-positive rate on legitimate inputs"
2. Baseline measurement: submit a corpus of known-scam and known-benign messages through the pipeline and record verdict distributions
3. Experimental modification: add or modify the defence layer (e.g., adding a new injection pattern, adjusting the confidence threshold)
4. Post-modification measurement: re-submit the same corpus and compare verdict distributions
5. Adversarial testing: craft novel injection attempts targeting the new defence and record bypass rate
6. Iterate: if bypass rate is unacceptable, formulate new hypothesis and repeat

Evidence of this methodology is recorded in Git commit history (descriptive commits tracking each iteration), the PROMPT_VERSION constant (incremented on each significant prompt change), and the 14 injection patterns (each added in response to a discovered bypass). [Data -- Git history exists; Assumption -- methodology described retrospectively but commits provide contemporaneous evidence]

**Activity 2 methodology (Risk scoring):**

1. Hypothesis: "Adding [signal X] to the composite score will improve discrimination between confirmed-malicious and benign entities"
2. Implement signal integration (enrichment pipeline + scoring RPC)
3. Run scoring across all entities with report_count >= 3
4. Manually review top-scored and bottom-scored entities against ground truth (deep investigation results, threat feed confirmations)
5. Adjust weights or thresholds based on false-positive/false-negative analysis
6. Iterate (enrichment cap adjustment from 25 to 40 is a documented example)

[Data -- migration history v27 through v42 shows iterative schema evolution; Assumption -- manual review was conducted but not formally documented as precision/recall metrics]

**Activity 3 methodology (PII scrubbing):**

1. Collect sample scam submissions containing diverse PII formats
2. Apply scrubbing pipeline and manually inspect outputs for leaked PII (false negatives) and over-scrubbed content (false positives)
3. Discover ordering dependency (Core Knowledge 3)
4. Reorder patterns and re-test
5. Add post-scrub cleanup pass for residual fragments

[Data -- ordered patterns and cleanup pass in `pipeline.ts`; Assumption -- testing corpus not formally preserved as a test suite]

**Contemporaneous documentation:**

- Git commits with descriptive messages (e.g., "Fix phone normalisation", "Persona check v2: accept URLs, emails, and multi-signal enrichment") [Data]
- 44 database migrations documenting schema evolution [Data]
- PROMPT_VERSION tracking in `@askarthur/types` [Data]
- Feature flag toggles for each enrichment API (independently toggleable) [Data]

---

### 6. Estimated Eligible Expenditure

*(~150 words)*

| Category | Estimated FY24-25 Spend | Eligible % | Eligible Amount |
|---|---|---|---|
| Founder labour (R&D activities) | [INSERT -- e.g., $80,000 based on hours logged] | 70% (excludes routine dev) | [INSERT] |
| Cloud infrastructure (Vercel, Supabase, Upstash, R2) | [INSERT -- e.g., $8,000] | 40% (R&D share only) | [INSERT] |
| AI inference (Anthropic API) | [INSERT -- e.g., $3,000] | 80% (primarily R&D experimentation) | [INSERT] |
| External APIs (AbuseIPDB, Twilio, URLScan, HIBP) | [INSERT -- e.g., $2,000] | 60% (R&D enrichment experiments) | [INSERT] |
| **Total eligible expenditure** | | | **[INSERT]** |
| **43.5% refundable offset** | | | **[INSERT]** |

[Estimate -- all figures require validation against actual financial records. Eligible percentages are initial estimates based on activity split; an R&D tax adviser should review before filing.]

**IMPORTANT:** Government grants received for the same R&D activity reduce eligible RDTI expenditure. If an IGP grant is received, coordinate claims to avoid double-dipping.

---

## APPLICATION 2: STARTMATE ACCELERATOR

**Program:** Startmate Accelerator (12-week program)
**Investment:** $120K at $1.5M post-money valuation
**Dilution:** ~8%

---

### 1. Founder-Market Fit

*(~400 words)*

I am a solo technical founder who has single-handedly built a production-grade, multi-platform scam detection platform across 11 development phases, 44 database migrations, 7 monorepo packages, and 6 user surfaces (web, extension, mobile, Telegram, WhatsApp, Slack, Messenger). This is not a prototype -- it is a production system with real API endpoints, real threat intelligence feeds, and real-time AI analysis. [Data -- codebase exists and is deployed]

**Why I understand this problem:**

Australia's scam crisis is not a technology gap -- it is an intelligence distribution gap. Banks see their own fraud. Telcos see their own call patterns. Digital platforms see their own reported content. No one sees the full picture. The Scams Prevention Framework Act 2025 mandates cross-sector intelligence sharing, but the infrastructure to enable it does not exist. I recognised that a free consumer scam checker could be the data acquisition layer that feeds a B2B threat intelligence API -- solving the consumer problem and the enterprise problem simultaneously. [Assumption -- strategic positioning]

**Why I can execute:**

The platform's breadth demonstrates execution capability that most pre-revenue startups lack:

- 16 automated threat feed integrations scraping data from PhishTank, URLhaus, ThreatFox, OpenPhish, Spamhaus, AbuseIPDB, CERT Australia, Scamwatch RSS, and 8 others [Data]
- 5 external enrichment API integrations (AbuseIPDB, HIBP, crt.sh, Twilio Lookup, URLScan.io) with feature-flagged independent toggles [Data]
- A composite risk scoring algorithm processing 10+ heterogeneous signals into entity risk scores [Data]
- A union-find clustering algorithm grouping related scam reports into campaigns [Data]
- 14-pattern prompt injection defence system with nonce delimiters and confidence thresholding [Data]
- 12-pattern PII scrubbing pipeline with Australian-specific format handling [Data]
- Government-ready threat intelligence export views (4 views for law enforcement) [Data]
- A unified security scanner covering websites, Chrome extensions, MCP servers, and AI skills with 60+ detection patterns [Data]
- Sub-$0.001 cost per analysis at current scale [Estimate -- based on Anthropic pricing for Claude Haiku]

**What I lack (and why I need Startmate):**

I am a technical founder without enterprise sales experience. The product is built. The regulatory tailwind is real. What I need is the commercial muscle, mentorship, and credibility to convert a production platform into a revenue-generating business. Solo-founder risk is real -- Startmate's co-founder matching, mentor network, and structured programme directly address this. [Assumption -- honest assessment]

---

### 2. What You Have Built

*(~450 words)*

Ask Arthur is Australia's first community-sourced scam intelligence platform. Users submit suspicious content (text, URLs, images, QR codes) via 6 surfaces and receive an instant AI-powered verdict -- SAFE, SUSPICIOUS, or HIGH_RISK -- with red flags, explanation, and next steps. Every check enriches a PII-scrubbed threat database that powers a B2B Threat Intelligence API for regulated entities. [Data -- production system deployed at askarthur.au]

**Consumer product (free):**

| Surface | Technology | Status |
|---|---|---|
| Web app | Next.js 16, React 19, Turbopack | Production [Data] |
| Chrome/Firefox extension | WXT framework | Production [Data] |
| Mobile app (iOS + Android) | Expo 54, React Native | Production [Data] |
| Telegram bot | Webhook-based | Production [Data] |
| WhatsApp bot | Webhook-based | Production [Data] |
| Slack bot | Slash commands | Production [Data] |
| Messenger bot | Webhook-based | Production [Data] |

**B2B Threat Intelligence API (monetised):**

Six endpoints with OpenAPI 3.0 specification and interactive Scalar documentation:

- Threat Trending (by period/region)
- URL Lookup (full enrichment: WHOIS, SSL, reputation)
- Trending URLs (most-reported domains with aggregation)
- Domain Aggregation (WHOIS enrichment)
- Aggregate Statistics (platform-wide threat metrics)
- Batch Entity Lookup (bulk URL, phone, email, IP queries)

Three tiers: Free (25 calls/day), Pro (100 calls/day, $2K/month), Enterprise (5,000 calls/day, $5K--$15K/month). Billing via Paddle with self-service API key management. [Data -- endpoints, billing, and key management are deployed]

**Unified Security Scanner:**

Beyond scam detection, multi-type security auditing covering websites (security headers, TLS, letter grade A+ to F), Chrome extensions (manifest analysis, 20+ checks, 8 categories), MCP servers (npm queries, OWASP MCP Top 10, 24+ checks), and AI skills (prompt injection detection, malware indicators, 16+ checks). Embeddable SVG security badges and dynamic OG images. [Data -- scanner packages exist in `packages/extension-audit/` and `packages/mcp-audit/`]

**Intelligence pipeline:**

- 16 threat feed integrations (automated scraping via GitHub Actions) [Data]
- 5 external enrichment APIs (AbuseIPDB, HIBP, crt.sh, Twilio, URLScan.io) [Data]
- WHOIS + SSL enrichment fan-out every 6 hours [Data]
- Certificate Transparency monitoring for Australian brand impersonation every 12 hours [Data]
- Deep investigation pipeline (nmap, dnsrecon, nikto, whatweb, sslscan) weekly [Data]
- 4 government-ready threat intelligence export views [Data]
- Union-find scam campaign clustering [Data]
- Composite 0--100 entity risk scoring [Data]

**Technology maturity (TRL assessment):**

| Component | TRL | Evidence |
|---|---|---|
| Consumer analysis pipeline | TRL 7 (system prototype in operational environment) | Production-deployed, processing real submissions [Data] |
| B2B Threat API | TRL 6 (system demonstrated in relevant environment) | Endpoints deployed, no paying customers yet [Data] |
| Intelligence pipeline | TRL 7 | 16 feeds ingesting, enrichment running on schedule [Data] |
| Security scanner | TRL 7 | All 4 scanner types production-deployed [Data] |
| Enterprise compliance layer | TRL 4 (component validation in lab) | Export views built, no enterprise integration tested [Estimate] |

---

### 3. Why Now

*(~350 words)*

Three forces converge to make this the right moment for Ask Arthur. Missing this window means missing the regulatory-driven market creation event.

**1. The Scams Prevention Framework Act 2025 creates forced demand (commencing 1 July 2026 -- less than 3 months away)**

The SPF Act received Royal Assent on 21 February 2025. From 1 July 2026, banks, telcos, and digital platforms must implement scam detection, intelligence-sharing, and consumer protection capabilities. Penalties reach the greater of ~A$52.7 million, three times the benefit obtained, or 30% of adjusted turnover. A private right of action allows consumers to sue for damages. Over 200 regulated entities must comply. [Data -- legislation is public record]

The Big Four banks are building in-house. But 80+ mid-tier ADIs, credit unions, MVNOs, and digital platforms lack the engineering capability to build their own systems. They need external solutions. Ask Arthur's Threat Intelligence API maps directly to the SPF's Detect, Report, Disrupt, and Prevent principles. [Assumption -- market gap positioning]

**2. AI-generated scams are overwhelming existing defences**

Large language models make it trivial to generate grammatically perfect, contextually aware phishing at scale. Traditional rule-based filters cannot keep up. Fighting AI-generated scams requires AI-powered detection. Claude's classification is now fast and cost-effective enough (~$0.001 per check) to deploy at consumer scale. [Estimate -- cost figure based on current Anthropic pricing]

**3. The Australian regulatory and investment environment is uniquely favourable**

- 61% of Australian VC capital is flowing into AI [Data -- public market reports]
- The R&D Tax Incentive provides 43.5% cash refunds for eligible AI research [Data]
- Main Sequence (CSIRO-backed) led Kasada's US$20M round (Feb 2026) in cybersecurity [Data]
- Tidal Ventures invested in SecurePII (Oct 2025) [Data]
- The National Reconstruction Fund has allocated $200M+ to sovereign technology [Data]

**The window is closing:** IGP funding is ~90% exhausted after MYEFO cuts. SPF-regulated entities are selecting compliance vendors now, not after July 2026. First-mover advantage in cross-sector threat intelligence is perishable -- the community data flywheel compounds, meaning a competitor starting 12 months from now would need 24+ months of data ingestion to match. [Assumption -- competitive moat claim]

---

### 4. What You Need from Startmate

*(~350 words)*

Ask Arthur's core problem is not technology -- the platform is built. The problem is commercial velocity. Startmate addresses the three specific gaps that are blocking revenue.

**Gap 1: Enterprise sales capability and introductions**

The B2B Threat API is production-ready with 6 endpoints, OpenAPI documentation, and tiered pricing. What is missing is a path to the first enterprise pilot. Startmate's corporate network and mentor introductions -- particularly to mid-tier banks (Bendigo, Bank of Queensland, Macquarie), telcos (Optus, TPG, Amaysim), and fintechs -- would compress the enterprise sales cycle from speculative outreach to warm introductions. [Assumption -- Startmate's network can provide this access]

Target: 2--3 enterprise proof-of-concept pilots within the 12-week programme.

**Gap 2: Co-founder matching**

Solo-founder risk is the single biggest structural weakness. I need a commercial co-founder with enterprise sales or financial services experience. Startmate's cohort model and co-founder matching programme are the most capital-efficient way to address this. [Assumption -- Startmate co-founder matching is effective for this profile]

Target: Identify and onboard a co-founder candidate during the programme.

**Gap 3: Investor credibility signal**

Ask Arthur is pre-revenue with a strong regulatory thesis and a production product. For the A$500K--$1M pre-seed raise that follows, Startmate's brand acts as a credibility signal to Tidal Ventures (strongest thesis fit -- invested in SecurePII), Main Sequence (invested in Kasada), AirTree (Fund V closed Aug 2025, cybersecurity focus), and Sydney Angels (invested in Apollo Secure). [Assumption -- Startmate brand accelerates fundraising]

Target: Close pre-seed round within 3--6 months of programme completion.

**Use of $120K investment:**

| Category | Amount | Purpose |
|---|---|---|
| Enterprise pilot programme | $40K | Free/discounted POC infrastructure costs, travel for on-site demonstrations |
| AFCX + GASA membership fees | $15K | Strategic ecosystem positioning for SPF compliance sales |
| Conference presence | $15K | Fraud & Financial Crime Australia 2026, AISA Australian Cyber Conference |
| Chrome Web Store + App Store submissions | $5K | Developer fees, compliance review |
| Operating runway | $45K | 3--6 months lean operations (infrastructure + AI costs) |

**What success looks like at programme end:**

- 2+ enterprise POC pilots in progress (mid-tier banks or telcos) [Estimate]
- Co-founder candidate identified [Estimate]
- Pre-seed investor conversations advanced with 3+ target funds [Estimate]
- AFCX membership application submitted [Estimate]
- Chrome Web Store and App Store listings live [Estimate]

---

## APPENDIX: SCORING NOTES

### For RDTI Assessors

- **Contemporaneous documentation**: Git commit history with descriptive messages provides timestamped evidence of experimental iterations. 44 database migrations document schema evolution. PROMPT_VERSION constant tracks prompt engineering iterations. Feature flags document independent toggle testing of each enrichment API.
- **Not business-as-usual**: The eligible activities are not routine software development. Building a Next.js web app is routine. Making an LLM adversarially robust for consumer-facing scam classification is not. Integrating a single external API is routine. Designing a composite scoring algorithm that fuses 10+ heterogeneous signals with experimentally-derived weights is not.
- **IP ownership**: All R&D conducted in Australia by a sole director/shareholder. No third-party contractors. Full IP ownership by the entity.
- **Pre-revenue status**: The company is pre-revenue. All expenditure in FY24-25 was R&D and product development. The 70% eligible labour estimate excludes time spent on routine UI development, DevOps, and billing integration.

### For Startmate Assessors

- **Pre-revenue honesty**: Ask Arthur has zero paying customers and zero revenue. The product is production-ready but has not been commercialised. There are no LOIs. The regulatory thesis is strong but unvalidated commercially. This application does not dress up a pre-revenue startup as a traction story -- it presents a built product seeking commercial velocity. [Assumption -- honest positioning is strategically correct for Startmate]
- **Additionality**: Without Startmate, Ask Arthur will likely pursue enterprise sales through cold outreach and conference networking -- a slower, higher-risk path. Startmate's programme compresses the timeline by 6--12 months through warm introductions, structured mentorship, and investor credibility. The $120K investment extends runway but is not the primary value -- the network and programme are. [Assumption -- additionality framing]
- **TRL assessment**: The consumer product is TRL 7 (production-deployed). The B2B API is TRL 6 (deployed but no customers). The enterprise compliance layer is TRL 4 (components built but not validated with enterprise customers). Startmate's programme targets moving the B2B API from TRL 6 to TRL 8 (first customer) and the compliance layer from TRL 4 to TRL 6 (enterprise pilot). [Estimate]

---

### Word Count Summary

| Section | Words |
|---|---|
| **RDTI: Core R&D Activities** | ~650 |
| **RDTI: Supporting R&D Activities** | ~350 |
| **RDTI: Technical Uncertainty** | ~400 |
| **RDTI: New Knowledge Generated** | ~300 |
| **RDTI: Experiment Methodology** | ~350 |
| **RDTI: Estimated Expenditure** | ~150 |
| **Startmate: Founder-Market Fit** | ~400 |
| **Startmate: What You Have Built** | ~450 |
| **Startmate: Why Now** | ~350 |
| **Startmate: What You Need from Startmate** | ~350 |
| **Appendix: Scoring Notes** | ~350 |

---

*Generated April 2026. All [Data] claims reference code, migrations, or public records in the Ask Arthur repository. All [Estimate] claims are projections requiring validation. All [Assumption] claims are strategic positioning that should be reviewed for defensibility.*
