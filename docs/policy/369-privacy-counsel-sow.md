# Privacy-counsel engagement SOW + outreach (#369)

**Status:** ready to send. Action: brendan picks a firm, customises the email below, sends.

**Budget envelope:** A$8-15K (per Shopfront plan §5 Stage 0 step 4).

**Target firms (AU privacy / APP-specialist):**

- **Maddocks** — privacy + commercial-tech practice; preferred if also engaging for #371 (bundle discount).
- **Gilbert + Tobin** — strong privacy + tech-law desk.
- **Lander & Rogers** — privacy specialist if the above don't fit.

---

## The question

**Does APP 6.2(c) ("permitted general situation — necessary to lessen or prevent a serious threat") apply to the cross-merchant federated clone-clustering architecture described below?**

Sub-questions:

- Does APP 8 (cross-border disclosure) bite, given the federated bloom-filter is local to AU infra but merchants are global?
- Are there APP 11 (security of personal information) refinements we should bake in given the architecture?
- Are there Notifiable Data Breach (NDB) consequences if a federated query reveals merchant-correlated information?

## The architecture (1-page summary)

Ask Arthur Shopfront detects clones of installed merchant stores. At Phase C (per ADR-0016), we extend single-merchant clone detection to **cross-merchant federated clustering**: when scammer infrastructure (shared SSL certs, shared hosting prefix, shared product-clone fingerprint, etc.) targets one Shield merchant, we want to surface that same infrastructure as a leading indicator to OTHER Shield merchants whose brands the same infrastructure may target next.

The privacy-sensitive design choice: do we share raw merchant identifiers across the cluster, or do we use a **federated bloom-filter** abstraction ("do you have _this hash_?") that surfaces the cluster without revealing merchant identities to each other?

Working proposal:

1. Each Shield merchant's clone-detection state is local to that merchant's row in `shopfront_clone_alerts` (no cross-merchant joins by default).
2. A **federated bloom-filter** records the hash-set of suspected scammer infrastructure observed across all Shield merchants — bloom-filter properties give probabilistic membership without revealing which merchant contributed each hash.
3. When a NEW clone-detection signal fires for merchant A, we query the bloom-filter to surface "this infrastructure has been observed before in our network" — _without_ telling merchant A which other merchant observed it.
4. Merchant A's surface shows the **infrastructure** (the SSL cert serial, the hosting prefix, the product-clone fingerprint) and a "this is a known scam network" badge. Merchant B (who originally contributed the hash) is never identified.

Open privacy questions:

- Is the bloom-filter contribution itself a "use or disclosure" under APP 6? If yes, does APP 6.2(c) cover it?
- Is the surfaced "this is a known network" inference a personal-information use case if it can be combined with downstream data?
- What if a merchant requests deletion under APP 12 / the Right to Erasure debate — can we surgically remove their hash contribution from the bloom-filter? (Spoiler: bloom-filters don't support deletion; we'd need a rebuild from the survivors.)
- Cross-border: bloom-filter sits on Supabase (US-based managed infra) even though merchants are global. Does APP 8.2(a) (contractually-bound overseas recipient) suffice, or do we need explicit consent at install?

## What we want from the engagement

- **A written opinion** addressing the question + sub-questions above, citing the specific APPs we're relying on for each architectural choice.
- **Concrete refinements** to the proposal: what changes would make the architecture safer / cleaner under APP 6.2(c)?
- **Worst-case framing**: what is the most-conservative read of APP that would invalidate this surface? (We need to know if a regulator pushes back, what our fallback architecture looks like.)
- **Citable language** for our public-facing privacy notice (Verified Shop install consent, Directory privacy policy) describing the federated-cluster behaviour in plain English.
- **Turnaround:** 6 weeks acceptable. Earlier preferred — gates Phase C build.

---

## Email draft

Subject: **Privacy-counsel engagement — federated clone-detection architecture under APP 6.2(c)**

> Hi [partner name],
>
> I'm Brendan Milton, founder of Ask Arthur (askarthur.au) — an AU scam-detection platform. We're scoping a Phase C upgrade to our forthcoming Shopify merchant app (Ask Arthur Shield) that introduces cross-merchant federated clone-clustering, and we need a written privacy-counsel opinion on whether APP 6.2(c) applies before we commit eng-weeks to the build.
>
> The full SOW is at: [docs/policy/369-privacy-counsel-sow.md — share access on request]. In brief: when scammer infrastructure targets one Shield merchant, we want to surface that same infrastructure as a leading indicator to other Shield merchants whose brands the same infrastructure may target next. The working proposal uses a federated bloom-filter abstraction to share the hash-set of suspected scammer infrastructure without revealing which specific merchant contributed each hash.
>
> Specific questions for opinion:
>
> 1. Does APP 6.2(c) ("permitted general situation — necessary to lessen or prevent a serious threat") cover the federated bloom-filter use case?
> 2. Are there APP 8 (cross-border disclosure) refinements we should bake in?
> 3. What concrete architectural changes would make this safer under APP?
> 4. Citable plain-English language for our public privacy notice describing this behaviour.
>
> Budget envelope: A$8-15K. Turnaround: 6 weeks acceptable, earlier preferred.
>
> Could you:
>
> - Confirm this is in scope for your team?
> - Quote against the envelope above, or scope a counter?
> - Indicate whether bundling with a separate disclaimer-pack engagement (#371 — A$3-5K fixed fee for consumer-facing copy across our merchant badge, Directory, and clone-detection alerts) might be efficient?
>
> Happy to share architecture documentation + jump on a 30-minute call to walk through the data flows.
>
> Brendan
> brendan.milton1211@gmail.com | askarthur.au

---

## Dependencies this unblocks

- **#384 Phase C clone-detection** (Voyage embeddings + cross-merchant clustering) — opinion is the gating artefact for the cross-merchant clustering surface specifically.
- The single-merchant Phase A + Phase B clone-detection doesn't need this opinion (no cross-merchant data flow). Only Phase C federation does.
