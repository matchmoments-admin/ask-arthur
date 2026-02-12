# Ask Arthur — Zero-Knowledge Privacy Architecture

## Overview

Ask Arthur is designed with a "zero-knowledge" approach: we analyse suspicious messages to protect users from scams while storing the absolute minimum data needed to improve our threat intelligence.

## Data Flow

```
User's Device                    Ask Arthur Infrastructure
─────────────                    ────────────────────────

1. User pastes message      →    HTTPS (TLS 1.3)
   or uploads screenshot         │
                                 ▼
2.                               Input Validation
                                 (size limits, format check)
                                 │
                                 ▼
3.                               PII Scrubbing Layer
                                 - Email addresses → [EMAIL]
                                 - Phone numbers → [PHONE]
                                 - TFNs → [TFN]
                                 - Medicare numbers → [MEDICARE]
                                 - Credit cards → [CARD]
                                 - Street addresses → [ADDRESS]
                                 - Names → [NAME]
                                 │
                                 ▼
4.                               Claude AI Analysis
                                 (Anthropic API — no data retained by Anthropic)
                                 │
                                 ▼
5.                               Verdict returned to user
                                 │
                                 ▼ (HIGH_RISK only)
6.                               Anonymised Storage
                                 - Supabase: scrubbed summary, red flags, scam type
                                 - R2: screenshot under random UUID (no metadata)
```

## What We NEVER Store

| Data Type | Stored? | Notes |
|-----------|---------|-------|
| Original message text | No | Analysed in memory, immediately discarded |
| IP addresses | No | Used only for rate limiting (hashed, ephemeral) |
| Cookies | No | We set zero cookies |
| User accounts | No | No signup required |
| Browser fingerprints | No | No tracking scripts |
| Location data | No | Geo-IP used only for aggregate regional stats |
| Personal names | No | Scrubbed before any storage |

## What We Store (HIGH_RISK Verdicts Only)

| Data | Purpose | Retention |
|------|---------|-----------|
| Scrubbed summary | Threat intelligence & blog generation | Indefinite |
| Red flags (scrubbed) | Pattern analysis | Indefinite |
| Scam type classification | Trend reporting | Indefinite |
| Impersonated brand | Brand alerting | Indefinite |
| Communication channel | Channel analysis | Indefinite |
| Confidence score | Quality monitoring | Indefinite |
| Region (state-level) | Geographic trend analysis | Indefinite |
| Screenshot (R2, UUID key) | Visual evidence for reports | Indefinite |

## Aggregate Statistics

We maintain daily aggregate counters for:
- Total checks performed (by verdict type)
- Regional distribution (state-level only)

These counters contain no personally identifiable information.

## Third-Party Services

| Service | Data Shared | Purpose |
|---------|------------|---------|
| Anthropic (Claude) | Message text (in-transit only) | Scam analysis |
| Google Safe Browsing | URLs extracted from messages | URL reputation check |
| VirusTotal | URLs extracted from messages | URL reputation check |
| Plausible Analytics | Page views (no PII) | Privacy-first analytics |
| Upstash Redis | Hashed IP+UA (ephemeral) | Rate limiting |
| Cloudflare R2 | Scrubbed screenshots | Storage |
| Supabase | Scrubbed scam records | Database |

## Compliance Alignment

- **Australian Privacy Act 1988**: Minimal collection principle (APP 3)
- **Australian Cyber Security Strategy 2023-2030**: Community threat intelligence
- **GDPR Article 25**: Data protection by design and by default
- **OWASP**: Input validation, output encoding, PII scrubbing

## Architecture Decisions

1. **No accounts**: Users never create accounts, so we never hold credentials
2. **Ephemeral analysis**: Messages exist in server memory only during the API call
3. **Hash-based rate limiting**: IPs are SHA-256 hashed with user-agent; we cannot reverse them
4. **Fire-and-forget storage**: Scam records are stored asynchronously; analysis completes regardless
5. **UUID-keyed screenshots**: No filename, metadata, or EXIF data retained; only a random UUID
