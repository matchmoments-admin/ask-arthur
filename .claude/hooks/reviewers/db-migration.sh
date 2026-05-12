#!/usr/bin/env bash
# .claude/hooks/reviewers/db-migration.sh
# Checks Critical Rules for database migrations + Python scrapers.
# Invoked by run-reviewer.sh PostToolUse when the edited file is under
# supabase/migrations/** or pipeline/scrapers/**.
#
# Output: markdown advisory block to stdout. Silent if all checks pass.
# Sources: CLAUDE.md Critical Rules + docs/adr/0005-pgvector-index-policy.md
# + incident 2026-05-09 memory + docs/system-map/database.md hot-table list.
#
# Budget: ≤3s. Pure grep / awk; no network, no LLM, no edits.

set -uo pipefail

file="$1"
rel="$2"
[ -r "$file" ] || exit 0

findings=()

# Hot-table list — write-frequent tables where new large indexes must go on
# a 1:1 sibling table (ADR-0005). Keep in sync with docs/system-map/database.md
# and CLAUDE.md "Never Do" #4.
HOT_TABLES_RE='acnc_charities|scam_reports|verified_scams|feedback_triage_queue|feed_items|scam_entities'

# --- 1. statement_timeout = 0 ----------------------------------------------
# CLAUDE.md "Never Do" #1: ban any "no cap" timeout. The 2026-05-09 incident
# was caused by a SET statement_timeout = 0 in a Python scraper that let a
# tail UPDATE hang for 20 hours.
if grep -qE "(SET[[:space:]]+(LOCAL[[:space:]]+)?statement_timeout[[:space:]]*=[[:space:]]*['\"]?0)|(statement_timeout[[:space:]]*:[[:space:]]*['\"]?0['\"]?[^0-9])" "$file" 2>/dev/null; then
  findings+=("**BLOCK_RECOMMENDED** — found \`statement_timeout = 0\` (or equivalent). CLAUDE.md Critical Rules ban this anywhere (migrations, scrapers, PL/pgSQL). Use \`'300s'\` and chunk the loop instead. See incident 2026-05-09.")
fi

# --- 2. Large unchunked UPDATE/DELETE on a hot table -----------------------
# CLAUDE.md "Never Do" #3: any UPDATE/DELETE/UPSERT > 5K rows on a hot table
# must be chunked. We can't measure row counts statically, but we can flag
# UPDATE/DELETE/INSERT statements that touch a hot table and have no obvious
# chunk pattern (WHERE pk = ANY(...), LIMIT, BATCH_SIZE).
if grep -qiE "(UPDATE|DELETE FROM|INSERT INTO|UPSERT)[[:space:]]+(public\.)?(${HOT_TABLES_RE})" "$file" 2>/dev/null; then
  # Look for chunking signal: WHERE ... = ANY( or LIMIT or BATCH_SIZE or chunk_size
  if ! grep -qiE "(= ANY\(|chunk_size|BATCH_SIZE|LIMIT [0-9]+|FETCH FIRST)" "$file" 2>/dev/null; then
    findings+=("**ADVISORY** — this file writes to a hot table (\`${HOT_TABLES_RE}\`) without an obvious chunking pattern. CLAUDE.md Critical Rules require chunking at ≤5K rows. See \`pipeline/scrapers/acnc_register.py\` for the reference shape (TOUCH_LAST_SEEN_SQL after PR #187).")
  fi
fi

# --- 3. HNSW / large GIN index directly on a hot table ---------------------
# ADR-0005 + CLAUDE.md "Never Do" #4: vector / HNSW / large GIN indexes go on
# a 1:1 sibling table (the acnc_charity_embeddings pattern, v121-v122). Never
# on the parent.
hnsw_lines="$(grep -nE "CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX.*USING[[:space:]]+(hnsw|ivfflat|gin)" "$file" 2>/dev/null || true)"
if [ -n "$hnsw_lines" ]; then
  while IFS= read -r line; do
    # Pull the table name (loose match: 'ON public.<table>' or 'ON <table>')
    tbl="$(printf '%s' "$line" | sed -nE "s/.*ON[[:space:]]+(public\.)?([a-zA-Z_][a-zA-Z0-9_]+).*/\2/p")"
    if [ -n "$tbl" ] && printf '%s' "$tbl" | grep -qE "^(${HOT_TABLES_RE})$"; then
      # Allow it if the CREATE INDEX has a partial WHERE clause that
      # constrains the population (the scam_reports / verified_scams pattern).
      if ! printf '%s' "$line" | grep -qiE "WHERE[[:space:]]+[a-zA-Z_]+[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL"; then
        findings+=("**BLOCK_RECOMMENDED** — \`${line}\` puts a vector/HNSW/GIN index directly on hot table \`${tbl}\`. ADR-0005 requires a 1:1 sibling table OR a partial \`WHERE embedding IS NOT NULL\` index. See \`acnc_charity_embeddings\` (v121) for the sibling pattern.")
      fi
    fi
  done <<< "$hnsw_lines"
fi

# --- 4. PL/pgSQL function gotchas: missing #variable_conflict use_column ---
# CLAUDE.md "Ship workflow" + incident 2026-05-06: RETURNS TABLE (col_name …)
# resolves unqualified col_name to OUT param, not table column. Need
# #variable_conflict use_column after AS $$.
if grep -qiE "RETURNS[[:space:]]+TABLE[[:space:]]*\(" "$file" 2>/dev/null; then
  if ! grep -qE "#variable_conflict[[:space:]]+use_column" "$file" 2>/dev/null; then
    findings+=("**ADVISORY** — found \`RETURNS TABLE (col_name …)\` without \`#variable_conflict use_column\` directive. Unqualified column references in the body will resolve to OUT parameters and raise \`42702: column reference is ambiguous\` at call time. Add \`#variable_conflict use_column\` immediately after \`AS \$\$\`. See packages/scam-engine/src/__tests__/rpcs.smoke.test.ts.")
  fi
fi

# --- 5. SECURITY INVOKER function with SET search_path = '' ----------------
# CLAUDE.md "Ship workflow": empty search_path hides pgvector operators (<=>)
# and similar extension operators. Use public, pg_catalog for INVOKER funcs.
if grep -qiE "SECURITY[[:space:]]+INVOKER" "$file" 2>/dev/null \
   && grep -qE "SET[[:space:]]+search_path[[:space:]]*=[[:space:]]*''" "$file" 2>/dev/null; then
  findings+=("**ADVISORY** — \`SECURITY INVOKER\` function with \`SET search_path = ''\` will hide extension operators like pgvector's \`<=>\`. Use \`SET search_path = public, pg_catalog\` for INVOKER funcs; reserve empty form for SECURITY DEFINER. See CLAUDE.md Standard ship workflow §PL/pgSQL gotchas.")
fi

# --- 6. Migration filename → advisor reminder ------------------------------
# Any new file under supabase/migrations/ should be smoke-tested + advisor-rechecked.
case "$rel" in
  supabase/migrations/*)
    findings+=("**REMINDER** — after applying, run \`mcp__supabase__get_advisors\` (security + performance) and \`packages/scam-engine/src/__tests__/rpcs.smoke.test.ts\` against a preview branch. New ERRORs must be fixed before merging the PR (per CLAUDE.md Standard ship workflow §6).")
    ;;
esac

# --- 7. Python scraper without chunked + bounded timeout pattern -----------
case "$rel" in
  pipeline/scrapers/*.py)
    # Look for any UPDATE/DELETE/UPSERT against a hot table
    if grep -qiE "(UPDATE|DELETE FROM|INSERT INTO|UPSERT)[[:space:]]+(public\.)?(${HOT_TABLES_RE})" "$file" 2>/dev/null; then
      # Require: explicit statement_timeout + chunk_size constant
      has_timeout="$(grep -cE "statement_timeout[[:space:]]*=[[:space:]]*['\"][0-9]+(s|m|ms)?['\"]" "$file" 2>/dev/null || echo 0)"
      has_chunk="$(grep -cE "(chunk_size|BATCH_SIZE|CHUNK_SIZE)[[:space:]]*=[[:space:]]*[0-9]+" "$file" 2>/dev/null || echo 0)"
      if [ "${has_timeout:-0}" -eq 0 ] || [ "${has_chunk:-0}" -eq 0 ]; then
        findings+=("**ADVISORY** — this scraper writes to a hot table but I don't see both \`statement_timeout = '300s'\` (or similar finite value) AND a \`chunk_size\`/\`BATCH_SIZE\` constant. CLAUDE.md Critical Rules require both. Reference: \`pipeline/scrapers/acnc_register.py\` TOUCH_LAST_SEEN_SQL after PR #187.")
      fi
    fi
    ;;
esac

# --- Emit ------------------------------------------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

printf '## db-migration-reviewer\n\n'
for f in "${findings[@]}"; do
  printf -- '- %s\n' "$f"
done
exit 0
