# Ask Arthur

Domain glossary for the Ask Arthur scam-detection platform. Used by the `improve-codebase-architecture` and `grill-with-docs` skills to ground suggestions in the project's language.

This file is **opinionated and tight**. When two words exist for the same concept, pick one and list the others as aliases to avoid. When a new term emerges in conversation that belongs in this glossary, add it inline — don't batch.

## Language

**Verdict**:
One of `SAFE | UNCERTAIN | SUSPICIOUS | HIGH_RISK` — the safety classification we return for any submitted content.
_Avoid_: result, classification, score, rating.

**Analysis Result**:
Complete output from the Claude analyzer: a Verdict plus confidence, red flags, and optional Phone Lookup Result / Redirect Chain enrichment.
_Avoid_: response, output, analysis (bare).

**Phone Lookup Result**:
Phone-number enrichment: carrier, VOIP status, risk score, caller name. Produced by the Twilio Lookup adapter, joined into an Analysis Result when the input contains a phone number.
_Avoid_: phone info, lookup, phone metadata.

**Redirect Chain**:
URL redirect trace: hop count, shortener detection, open-redirect flags. Joined into an Analysis Result when the input contains a URL.
_Avoid_: URL trace, hop trace.

**Scam Report**:
A user-submitted suspicious item plus its Verdict, channel of origin, impersonated brand (if any), and Scam Cluster linkage. The unit of record in `scam_reports`.
_Avoid_: submission, ticket, case, incident.

**Scam Entity**:
A phone, email, URL, domain, or IP extracted from a Scam Report. Carries first-seen/last-seen timeline and a risk score that updates as new Scam Reports reference it.
_Avoid_: indicator, IOC, observable, artifact.

**Scam Cluster**:
A group of Scam Reports linked by shared Scam Entities, text similarity, or a common impersonated brand. Tracks aggregate member count and total reported loss.
_Avoid_: group, campaign, ring.

**Unified Scan Result**:
Output of a security audit (websites / Chrome extensions / MCP servers / AI skills): a letter grade `A+ → F` plus per-check severity. Distinct from a Verdict — Verdicts classify content; Unified Scan Results audit installable software.
_Avoid_: audit, scan, scan output.

## Relationships

- An **Analysis Result** produces exactly one **Verdict**.
- An **Analysis Result** may carry zero or one **Phone Lookup Result** and zero or one **Redirect Chain**, depending on what the input contained.
- A **Scam Report** has exactly one **Verdict** and references zero or more **Scam Entities**.
- A **Scam Entity** appears in one or more **Scam Reports**; its risk score is a function of how many.
- A **Scam Cluster** groups two or more **Scam Reports** by overlapping **Scam Entities** or matching impersonated brand.
- A **Unified Scan Result** is independent of the Scam Report graph — different domain, same platform.

## Example dialogue

> **Dev:** "When the analyzer flags a phone number as `HIGH_RISK`, do we automatically create a Scam Report?"
> **Domain expert:** "No — the Analysis Result is per-request. A Scam Report is created when the user explicitly submits the content for the corpus. The Verdict on the Analysis Result and the Verdict on the Scam Report can differ if the analyzer was re-run later."

> **Dev:** "If two Scam Reports both reference `+61400000000`, are they automatically in the same Scam Cluster?"
> **Domain expert:** "They share a Scam Entity, which is one of the cluster signals — but the cluster also weighs text similarity and brand. Sharing one entity is necessary, not sufficient."

## Flagged ambiguities

- **"case"** is used informally to mean both **Scam Report** (the user-submitted item) and a Breach Defence case (a separate Phase-1 commercial concept tracked in `BACKLOG.md → Database Hygiene & SPF Readiness`). Keep distinct: prefer **Scam Report** for the consumer-flow item; reserve "case" for Breach Defence work, and define it precisely if/when that surface ships.
- **"alert"** is overloaded: brand alerts (sent to monitored businesses), cost-telemetry alerts (Telegram digests), and oncall alerts (none yet) are different concepts. Resolve before adding the term to this glossary.
- **"campaign"** is overloaded: marketing campaigns (the `docs/campaigns/` folder) and scam campaigns (a near-synonym for **Scam Cluster** with an impersonated-brand axis). Prefer **Scam Cluster** for the scam-side meaning.
