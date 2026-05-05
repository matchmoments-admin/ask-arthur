# Evals — promptfoo regression suite

Round-2 audit (i) closure (skeleton). Behavioural-regression tests for the
`analyzeWithClaude` prompt path. Each fixture is a real scam (or
legitimate) message + the verdict + red-flag invariants we expect Haiku
to produce. A failing fixture in CI means the prompt change in this PR
broke a known-good case.

## When to use this vs. Vitest

| Layer            | Tool      | Tests                          | Where it lives                                             | When it runs                          |
| ---------------- | --------- | ------------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| Pure logic       | Vitest    | `mergeVerdict` etc             | `packages/core-analysis`, `packages/scam-engine/__tests__` | Every PR, every commit                |
| Prompt + AI call | promptfoo | `analyzeWithClaude` end-to-end | `evals/`                                                   | Manual, or when `evals/` files change |

Vitest is fast (no API calls). promptfoo runs real Haiku calls and
assertions on the JSON output — slow, costly, and only meaningful when
the prompt text actually changes. The CI workflow at
`.github/workflows/promptfoo.yml` only runs when files under `evals/`
or `packages/scam-engine/src/claude.ts` change in a PR.

## Layout

```
evals/
├── README.md                    ← you are here
├── promptfooconfig.yaml         ← provider + assertions config
├── fixtures/                    ← one YAML per scam pattern
│   ├── payid-relative.yaml
│   ├── ato-tax-refund.yaml
│   ├── safe-billing-receipt.yaml
│   └── injection-attempt.yaml
└── runner.ts                    ← promptfoo provider that wires Haiku
```

## Running locally

```bash
pnpm dlx promptfoo eval --config evals/promptfooconfig.yaml
pnpm dlx promptfoo view  # open the HTML report
```

Requires `ANTHROPIC_API_KEY` set. Each run hits real Haiku — budget
roughly $0.005 per fixture × 4 fixtures = $0.02 per run.

## Adding a fixture

1. Find a high-impact case from `verdict_feedback` (where
   `training_consent = true` AND `user_says IN ('false_positive',
'false_negative', 'user_reported')`). Copy the scrubbed text.
2. Create `evals/fixtures/<short-slug>.yaml` with the schema below.
3. Run `pnpm dlx promptfoo eval` locally to confirm Haiku passes.
4. Commit the YAML. CI will run it on the next PR.

```yaml
description: |
  Why this fixture exists — what behaviour it locks in.
input:
  text: |
    The exact (scrubbed) text the user submitted.
  mode: text
expected:
  verdict: HIGH_RISK
  redFlagPatterns:
    - "PayID"
    - "marketplace"
  scamType: phishing
```

## Follow-ups (not in the skeleton PR)

- **Fixture extraction Inngest job** — `verdict_feedback WHERE
training_consent = true AND processed_at IS NULL` → write
  `evals/fixtures/auto/<id>.yaml`. Manual review then promotes them
  into the curated set.
- **Cost-budget guard** — abort the eval run if cumulative spend
  exceeds `EVAL_BUDGET_USD` (default \$1).
- **Themes injection coverage** — when `FF_RAG_THEMES` is on, the
  prompt has different context. Add a parallel fixture set that
  exercises both code paths.
