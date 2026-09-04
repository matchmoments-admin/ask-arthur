/**
 * Explicit column lists for the public and B2B lookup routes.
 *
 * WHY THESE EXIST.
 *
 * `/api/feed` published `feed_items.body_md` — the full text of every scraped
 * Reddit post — to every caller. A migration had already revoked the column
 * from anon and authenticated roles, and that migration was correct; the route
 * uses `createServiceClient`, which bypasses column grants by design. The
 * actual publisher was `select("*")`: the column list was "whatever the table
 * has today", so adding a column published it.
 *
 * These five routes have the same shape. Nothing is leaking from them right
 * now — each one hand-picks the fields it puts in the response, so the extra
 * columns are fetched and discarded. But "safe because the response builder
 * happens to be careful" is not a property the schema can rely on, and the
 * feed leak is what it looks like when that stops being true.
 *
 * ONE STRING LITERAL PER LIST, DELIBERATELY.
 *
 * supabase-js infers the row type from the literal passed to `.select()`. A
 * `.join()`, a template with a substitution, or `"a, " + "b"` all widen it to
 * `string`, and the result degrades to `ParserError` / `GenericStringError` —
 * every field access then typechecks as `any` and the compiler stops being a
 * check on this file at all. Keep each constant a single literal, however long
 * the line gets. Same rule as `FEED_ITEM_SELECT` in `lib/feed.ts`.
 *
 * WHAT IS DELIBERATELY ABSENT, and why. `lib/__tests__/b2bColumns.test.ts`
 * asserts each of these by name, so a column added to one of these tables
 * cannot quietly join a response:
 *
 *   scam_urls.whois_raw            the unparsed WHOIS record. Registrant name,
 *                                  email and phone survive in it whenever the
 *                                  registrar does not redact — real PII, and
 *                                  the parsed fields beside it are what the
 *                                  API is for.
 *   scam_entities.raw_value        the entity exactly as reported: a phone
 *                                  number, an email address, a wallet. The
 *                                  whole point of `normalized_value` is that
 *                                  it is the one safe to publish.
 *   scam_entities.investigation_data
 *   scam_entities.evidence_r2_key  internal investigation state and a pointer
 *                                  into private object storage.
 *   scam_entities.legal_basis
 *   scam_entities.consent_basis    compliance provenance. Ours to record, not
 *                                  a customer-facing field.
 *   scam_clusters.total_loss       aggregate reported financial loss. An
 *                                  internal figure; publishing it invites
 *                                  citation as a statistic we have not stood
 *                                  behind.
 */

/**
 * `scam_urls` for `/api/scam-urls/lookup`.
 *
 * Covers both queries in that route — the domain sweep and the single-URL
 * lookup — because the domain branch reads a strict subset of these.
 */
export const SCAM_URL_LOOKUP_COLUMNS =
  "normalized_url, domain, subdomain, tld, report_count, unique_reporter_count, confidence_score, confidence_level, primary_scam_type, brand_impersonated, google_safe_browsing, virustotal_malicious, virustotal_score, whois_registrar, whois_registrant_country, whois_created_date, whois_expires_date, whois_is_private, ssl_valid, ssl_issuer, ssl_days_remaining, first_reported_at, last_reported_at";

/**
 * `scam_urls` for `/api/v1/threats/urls/lookup`.
 *
 * A superset of the consumer list: the B2B response also carries `full_path`,
 * `source_type`, the name servers, the WHOIS lookup timestamp, `is_active`,
 * and `feed_sources`, which `deriveRegulators()` reads to decide whether a
 * regulator confirmed the URL.
 */
export const SCAM_URL_B2B_COLUMNS =
  "normalized_url, domain, subdomain, tld, full_path, source_type, report_count, unique_reporter_count, confidence_score, confidence_level, primary_scam_type, brand_impersonated, google_safe_browsing, virustotal_malicious, virustotal_score, whois_registrar, whois_registrant_country, whois_created_date, whois_expires_date, whois_name_servers, whois_is_private, whois_lookup_at, ssl_valid, ssl_issuer, ssl_days_remaining, first_reported_at, last_reported_at, is_active, feed_sources";

/**
 * `scam_entities` for `/api/v1/entities/[id]` and `/api/v1/entities/lookup`.
 *
 * `id` is here because the lookup route uses it to find linked reports, not
 * because the response needs it.
 */
export const SCAM_ENTITY_COLUMNS =
  "id, entity_type, normalized_value, report_count, first_seen, last_seen, enrichment_status, enrichment_data, risk_score, risk_level, risk_factors";

/** `scam_clusters` for `/api/v1/clusters/[id]`. */
export const SCAM_CLUSTER_COLUMNS =
  "id, cluster_type, primary_scam_type, primary_brand, member_count, entity_count, status, metadata, first_seen, last_seen";
