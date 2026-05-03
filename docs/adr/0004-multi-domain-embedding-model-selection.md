# Multi-domain embedding model selection

**Status:** accepted (2026-05-04)

`embed()` and `embedQuery()` in `packages/scam-engine/src/embeddings.ts` accept a `domain: "generic" | "finance" | "multimodal"` option. Each domain maps to a default model id (`voyage-3.5`, `voyage-finance-2`, `voyage-multimodal-3.5`) and is overridable per-domain via `EMBEDDING_MODEL_GENERIC`, `EMBEDDING_MODEL_FINANCE`, `EMBEDDING_MODEL_MULTIMODAL`. The legacy `EMBEDDING_PROVIDER=voyage|openai` env var still works but applies only to the generic domain — finance/multimodal never had an OpenAI counterpart.

We added this because the production-default `voyage-3.5` under-recalls finance jargon (cosine on "ASIC-licensed broker" / "wholesale-investor exemption" / "AUSTRAC-registered" lands well below the threshold a domain-tuned model gives), and we want investment / crypto / BEC / bank-impersonation surfaces to use `voyage-finance-2` without a fork in `embeddings.ts`. Multimodal is registered alongside so the env-var routing is forward-compatible — the actual `voyage-multimodal-3.5` request shape (interleaved text / image / video content blocks) lands in a later phase, until then `domain="multimodal"` throws on call rather than silently routing to a wrong model.

## Why a model registry rather than per-provider switch

The previous shape was a two-lane provider switch (`voyage` vs `openai`). Adding a third lane (`voyage-finance-2`) inside that switch would have meant either (a) an `EmbeddingProvider` enum that mixes provider and domain (`"voyage" | "voyage-finance" | "openai"`) or (b) per-call provider override that callers have to know to set. Both leak the model selection into every call site. A model-id-keyed `MODEL_REGISTRY` lets the call site say `domain: "finance"` and never know which model is current — when we swap finance from `voyage-finance-2` to `voyage-finance-3` we change the registry default and reindex per ADR-0003, no caller change.

## Why `output_dimension` (and OpenAI `dimensions`) is per-spec

Voyage 3.5 / 3.5-lite / multimodal-3.5 / context-3 / code-3 / 4-series all support Matryoshka truncation via the `output_dimension` request param. `voyage-finance-2` and `voyage-law-2` do not — they return a fixed native dimension and Voyage rejects requests that include `output_dimension`. The `supportsTruncation` flag on each `ModelSpec` toggles whether the param is included. Same logic for OpenAI's `dimensions` field on text-embedding-3-small.

## Why multimodal is registered but throws

Two alternatives: (a) leave multimodal out of the `EmbeddingDomain` union entirely until the call path lands, (b) register and throw on invocation. We took (b) because it lets us land the env var (`EMBEDDING_MODEL_MULTIMODAL`), the cost-telemetry pricing constant, and the domain enum value all at once — Phase E becomes a pure call-path implementation rather than a wiring change spread across `turbo.json`, `cost-telemetry.ts`, and `embeddings.ts`. The throw is loud and immediate so a misconfigured `EMBEDDING_MODEL_GENERIC=voyage-multimodal-3.5` fails at the first call rather than silently mis-routing.

## Why preserve `EMBEDDING_PROVIDER` instead of deleting it

There is exactly one production caller of `embed()` today (the Reddit Intel pipeline) and the env var is set in Vercel + every preview environment. Deleting the env var name would force a Vercel config change in lockstep with the deploy, which adds risk for zero benefit. The variable still works but is now scoped to the generic domain only — finance and multimodal callers are unaffected by its value. We will deprecate it once `EMBEDDING_MODEL_GENERIC` has been set in every env (~30 days) and remove it in a follow-up.

## Per-row model id remains the source of truth

ADR-0003's per-row `*_model_version TEXT` requirement is unchanged. Each `EmbedResult` now carries `domain` alongside `modelId` and `provider`, but the column we persist is still the model id — the domain is derivable from the registry and not load-bearing for the reindex policy. Don't add a `*_domain` column.
