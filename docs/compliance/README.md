# Compliance Documentation

Compliance documents in this directory use a shared six-section shape:

1. **Scope** - the product surface, data, processors, jurisdictions, and users covered by the document.
2. **Data flow** - the concrete source-to-storage-to-consumer path, including the code paths or workers that move the data.
3. **Retention table** - every personal-information-adjacent field or artefact, its retention class, and the cron, RPC, or manual control that enforces it.
4. **Cross-border disclosure (APP 8)** - overseas processors, data disclosed, safeguards, and the operator accountability position.
5. **Decision log** - dated approvals, sign-offs, and material amendments.
6. **Out-of-scope acknowledgement** - explicit gaps and future work so reviewers do not treat silence as approval.

The shape keeps compliance evidence auditable. A reviewer should be able to move from a claim in a compliance doc to the enforcing file, migration, cron, or route without searching the whole monorepo.

## Documents

| Document                                                       | Scope                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [privacy-impact-assessment.md](./privacy-impact-assessment.md) | Reddit Intel privacy impact assessment for the narrative pipeline, Anthropic, Voyage, retention, and APP 8.        |
| [reddit-tos-compliance.md](./reddit-tos-compliance.md)         | Reddit content-use commitments: OAuth preference, quote limit, permalink attribution, and no individual profiling. |
| [data-residency-statement.md](./data-residency-statement.md)   | Platform-level data residency statement.                                                                           |
| [security-posture.md](./security-posture.md)                   | Platform-level security posture overview.                                                                          |
