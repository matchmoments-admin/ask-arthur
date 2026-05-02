---
status: accepted
---

# Multi-pillar verification module shape

Charity Check (`packages/charity-check`) is the second feature in the codebase that runs in parallel against multiple external sources, scores each as a "pillar", and composes a single verdict via weighted-sum + graceful degradation. Phone Footprint (`packages/scam-engine/src/phone-footprint/`) was the first. Per `.claude/skills/improve-codebase-architecture/LANGUAGE.md` ("two adapters mean a real seam"), this is the moment the shape becomes a real pattern rather than a hypothetical one.

We chose to **copy the shape — `provider-contract.ts` + `orchestrator.ts` + `scorer.ts` + `unavailablePillar()` + `withTimeout()` — into the charity-check package** rather than extract a shared `@askarthur/scam-engine/multi-pillar` module now. The two implementations share roughly 80% of their structural choices (Promise.allSettled with per-provider timeouts; pillar-id keyed result map; weight-redistribution when pillars report `available: false`; coverage map for UI hints) but differ enough in their domain types (`PillarId` vs `CharityPillarId`, `Footprint` vs `CharityCheckResult`, msisdn-keyed vs ABN-or-name-keyed input) that a premature shared abstraction would force generics that obscure both call sites without saving meaningful code.

When a third multi-pillar feature appears, the duplication will be obvious and the right generic shape will be discoverable. Until then, two parallel implementations with the same vocabulary are the cheaper choice — and CONTEXT.md captures the shared terms ("Pillar", "Charity Check Result", "Footprint") so the duplication doesn't drift conceptually.

**Consequence to manage:** any tightening to the orchestrator or scorer pattern (timeout handling, weight semantics, coverage state machine) needs to be applied to both packages until the extraction happens. This file is the place to record any such co-evolution decisions; until that day, the two implementations are kept in lockstep by code review, not by code reuse.
