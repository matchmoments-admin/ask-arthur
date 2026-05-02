"""ACNC Charity Register — local Postgres mirror.

Data source: https://data.gov.au/data/dataset/acnc-register
Resource:    eb1e6be4-5b13-4feb-b28e-388bf7c26f93 (XLSX, datastore_active)
License:     CC BY 3.0 AU
Refresh:     Source updates weekly; scraper runs daily and is a no-op when
             every row's hash matches what's already in the table.

CKAN datastore_search returns paged JSON. We page in 5,000-row chunks,
transform each row to the acnc_charities schema, then bulk-upsert with
INSERT ... ON CONFLICT (abn) DO UPDATE WHERE source_row_hash IS DISTINCT.
The WHERE clause is what makes the daily run cheap — only rows whose
content actually changed produce a write.
"""

import hashlib
import os
import time
from typing import Any

import psycopg2
import psycopg2.extras
import requests

from common.db import get_db, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "acnc_register"
RESOURCE_ID = "eb1e6be4-5b13-4feb-b28e-388bf7c26f93"
CKAN_BASE = "https://data.gov.au/data/api/3/action/datastore_search"
PAGE_SIZE = 5000
USER_AGENT = "AskArthur-CharityCheck/1.0 (+https://askarthur.au)"
BATCH = 500

# CKAN columns are 8 boolean per-state flags; we flatten to a TEXT[] of state codes.
STATE_COLS: list[tuple[str, str]] = [
    ("Operates_in_ACT", "ACT"),
    ("Operates_in_NSW", "NSW"),
    ("Operates_in_NT", "NT"),
    ("Operates_in_QLD", "QLD"),
    ("Operates_in_SA", "SA"),
    ("Operates_in_TAS", "TAS"),
    ("Operates_in_VIC", "VIC"),
    ("Operates_in_WA", "WA"),
]

# 12 charity-purpose flags, flattened to a TEXT[] of stable internal tags.
# Tags chosen for legibility and stability across CKAN column renames.
PURPOSE_COLS: list[tuple[str, str]] = [
    ("Preventing_or_relieving_suffering_of_animals", "animal_welfare"),
    ("Advancing_Culture", "culture"),
    ("Advancing_Education", "education"),
    ("Advancing_Health", "health"),
    ("Promote_or_oppose_a_change_to_law__government_poll_or_prac", "law_change"),
    ("Advancing_natual_environment", "environment"),
    ("Promoting_or_protecting_human_rights", "human_rights"),
    ("Purposes_beneficial_to_ther_general_public_and_other_analogous", "general_public"),
    ("Promoting_reconciliation__mutual_respect_and_tolerance", "reconciliation"),
    ("Advancing_Religion", "religion"),
    ("Advancing_social_or_public_welfare", "social_welfare"),
    ("Advancing_security_or_safety_of_Australia_or_Australian_public", "national_security"),
]

# 29 beneficiary flags, flattened to a TEXT[] of stable internal tags.
BENEFICIARY_COLS: list[tuple[str, str]] = [
    ("Aboriginal_or_TSI", "aboriginal_tsi"),
    ("Adults", "adults"),
    ("Aged_Persons", "aged"),
    ("Children", "children"),
    ("Communities_Overseas", "overseas_communities"),
    ("Early_Childhood", "early_childhood"),
    ("Ethnic_Groups", "ethnic_groups"),
    ("Families", "families"),
    ("Females", "females"),
    ("Financially_Disadvantaged", "financially_disadvantaged"),
    ("LGBTIQA+", "lgbtiqa"),
    ("General_Community_in_Australia", "general_community_au"),
    ("Males", "males"),
    ("Migrants_Refugees_or_Asylum_Seekers", "migrants_refugees_asylum"),
    ("Other_Beneficiaries", "other_beneficiaries"),
    ("Other_Charities", "other_charities"),
    ("People_at_risk_of_homelessness", "homelessness_risk"),
    ("People_with_Chronic_Illness", "chronic_illness"),
    ("People_with_Disabilities", "disabilities"),
    ("Pre_Post_Release_Offenders", "offenders"),
    ("Rural_Regional_Remote_Communities", "rural_regional_remote"),
    ("Unemployed_Person", "unemployed"),
    ("Veterans_or_their_families", "veterans"),
    ("Victims_of_crime", "victims_crime"),
    ("Victims_of_Disasters", "victims_disasters"),
    ("Youth", "youth"),
    ("animals", "animals"),
    ("environment", "environment"),
    ("other_gender_identities", "other_gender"),
]

# Single-statement upsert. WHERE clause makes content-equal rows return no
# RETURNING row, which the caller treats as "skipped".
UPSERT_SQL = """
INSERT INTO acnc_charities (
  abn, charity_legal_name, other_names, charity_website,
  address_line_1, address_line_2, address_line_3,
  town_city, state, postcode, country,
  charity_size, registration_date, date_established,
  number_responsible_persons, financial_year_end,
  operates_in_states, operating_countries,
  is_pbi, is_hpc, purposes, beneficiaries,
  source_resource_id, source_row_hash
)
VALUES %s
ON CONFLICT (abn) DO UPDATE SET
  charity_legal_name          = EXCLUDED.charity_legal_name,
  other_names                 = EXCLUDED.other_names,
  charity_website             = EXCLUDED.charity_website,
  address_line_1              = EXCLUDED.address_line_1,
  address_line_2              = EXCLUDED.address_line_2,
  address_line_3              = EXCLUDED.address_line_3,
  town_city                   = EXCLUDED.town_city,
  state                       = EXCLUDED.state,
  postcode                    = EXCLUDED.postcode,
  country                     = EXCLUDED.country,
  charity_size                = EXCLUDED.charity_size,
  registration_date           = EXCLUDED.registration_date,
  date_established            = EXCLUDED.date_established,
  number_responsible_persons  = EXCLUDED.number_responsible_persons,
  financial_year_end          = EXCLUDED.financial_year_end,
  operates_in_states          = EXCLUDED.operates_in_states,
  operating_countries         = EXCLUDED.operating_countries,
  is_pbi                      = EXCLUDED.is_pbi,
  is_hpc                      = EXCLUDED.is_hpc,
  purposes                    = EXCLUDED.purposes,
  beneficiaries               = EXCLUDED.beneficiaries,
  source_resource_id          = EXCLUDED.source_resource_id,
  source_row_hash             = EXCLUDED.source_row_hash,
  updated_at                  = NOW()
WHERE acnc_charities.source_row_hash IS DISTINCT FROM EXCLUDED.source_row_hash
RETURNING (xmax = 0) AS is_new
"""


def _flag(value: Any) -> bool:
    """Source uses 'Y' for true, blank/None for false."""
    return str(value or "").strip().upper() in {"Y", "YES", "TRUE", "1"}


def _normalize_abn(value: Any) -> str | None:
    """Strip non-digits; return None unless exactly 11 digits remain."""
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return digits if len(digits) == 11 else None


def _parse_date(value: Any) -> str | None:
    """Source dates arrive as 'DD/MM/YYYY'; return ISO 'YYYY-MM-DD' or None."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    parts = text.split("/")
    if len(parts) == 3:
        d, m, y = parts
        if len(y) == 4 and d.isdigit() and m.isdigit() and y.isdigit():
            return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    # Some rows arrive ISO already.
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return text
    return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or not text.lstrip("-").isdigit():
        return None
    return int(text)


def _split_other_names(value: Any) -> list[str]:
    """Source separates multiple trading names with commas, semicolons, or CR/LF."""
    if not value:
        return []
    text = str(value).strip()
    if not text:
        return []
    out: list[str] = []
    for chunk in text.replace("\r", "\n").replace(";", "\n").split("\n"):
        c = chunk.strip(" ,;-")
        if c:
            out.append(c)
    return out


def _clean_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def transform_row(record: dict) -> dict | None:
    """Map one CKAN record → acnc_charities row dict, or None if invalid.

    Drop reasons:
      * ABN missing or non-11-digit (synthetic _id rows at the head of the
        dataset are typically incomplete)
      * Charity_Legal_Name blank
    """
    abn = _normalize_abn(record.get("ABN"))
    name = _clean_str(record.get("Charity_Legal_Name"))
    if not abn or not name:
        return None

    return {
        "abn": abn,
        "charity_legal_name": name,
        "other_names": _split_other_names(record.get("Other_Organisation_Names")),
        "charity_website": _clean_str(record.get("Charity_Website")),
        "address_line_1": _clean_str(record.get("Address_Line_1")),
        "address_line_2": _clean_str(record.get("Address_Line_2")),
        "address_line_3": _clean_str(record.get("Address_Line_3")),
        "town_city": _clean_str(record.get("Town_City")),
        "state": _clean_str(record.get("State")),
        "postcode": _clean_str(record.get("Postcode")),
        "country": _clean_str(record.get("Country")),
        "charity_size": _clean_str(record.get("Charity_Size")),
        "registration_date": _parse_date(record.get("Registration_Date")),
        "date_established": _parse_date(record.get("Date_Organisation_Established")),
        "number_responsible_persons": _parse_int(record.get("Number_of_Responsible_Persons")),
        "financial_year_end": _clean_str(record.get("Financial_Year_End")),
        "operates_in_states": [code for col, code in STATE_COLS if _flag(record.get(col))],
        "operating_countries": _clean_str(record.get("Operating_Countries")),
        "is_pbi": _flag(record.get("PBI")),
        "is_hpc": _flag(record.get("HPC")),
        "purposes": [tag for col, tag in PURPOSE_COLS if _flag(record.get(col))],
        "beneficiaries": [tag for col, tag in BENEFICIARY_COLS if _flag(record.get(col))],
    }


def compute_row_hash(row: dict) -> str:
    """MD5 of the row's content (excluding the ABN key itself, since it's
    constant per row by construction). Used to skip writes when the source
    row hasn't changed since the last ingest.
    """
    keys = sorted(k for k in row if k != "abn")
    payload = "|".join(f"{k}={row[k]!r}" for k in keys)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def fetch_all_records() -> list[dict]:
    """Page through CKAN datastore_search until exhausted."""
    out: list[dict] = []
    offset = 0
    headers = {"User-Agent": USER_AGENT}
    while True:
        resp = requests.get(
            CKAN_BASE,
            params={"resource_id": RESOURCE_ID, "limit": PAGE_SIZE, "offset": offset},
            headers=headers,
            timeout=120,
        )
        resp.raise_for_status()
        body = resp.json()
        if not body.get("success"):
            raise RuntimeError(f"CKAN datastore_search returned success=false: {body}")
        result = body["result"]
        records = result.get("records", [])
        if not records:
            break
        out.extend(records)
        total = int(result.get("total") or 0)
        if offset + len(records) >= total:
            break
        offset += len(records)
        logger.info(
            f"ACNC fetch progress: {len(out)}/{total}",
            extra={"metadata": {"feed": FEED_NAME, "offset": offset}},
        )
    return out


def upsert_charities(conn, rows: list[dict]) -> dict:
    """Bulk upsert by ABN in 500-row batches.

    new vs updated is detected by RETURNING (xmax = 0): xmax is 0 for
    inserts, non-zero for ON CONFLICT updates. Rows whose source_row_hash
    is unchanged fall through the WHERE clause and produce no RETURNING
    row, which we count as 'skipped'.
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    cursor = conn.cursor()
    upsert_start = time.time()
    total = len(rows)
    total_batches = (total + BATCH - 1) // BATCH

    for batch_num, i in enumerate(range(0, total, BATCH), start=1):
        batch = rows[i : i + BATCH]
        batch_start = time.time()
        values = [
            (
                r["abn"],
                r["charity_legal_name"],
                r["other_names"],
                r["charity_website"],
                r["address_line_1"],
                r["address_line_2"],
                r["address_line_3"],
                r["town_city"],
                r["state"],
                r["postcode"],
                r["country"],
                r["charity_size"],
                r["registration_date"],
                r["date_established"],
                r["number_responsible_persons"],
                r["financial_year_end"],
                r["operates_in_states"],
                r["operating_countries"],
                r["is_pbi"],
                r["is_hpc"],
                r["purposes"],
                r["beneficiaries"],
                RESOURCE_ID,
                r["_hash"],
            )
            for r in batch
        ]
        try:
            results = psycopg2.extras.execute_values(
                cursor,
                UPSERT_SQL,
                values,
                fetch=True,
            )
            touched = 0
            for row in results:
                touched += 1
                if row[0]:
                    stats["new"] += 1
                else:
                    stats["updated"] += 1
            stats["skipped"] += len(batch) - touched
            conn.commit()
        except Exception as e:
            conn.rollback()
            stats["skipped"] += len(batch)
            logger.error(
                f"ACNC batch {batch_num} failed: {e}",
                extra={"metadata": {"feed": FEED_NAME, "batch": batch_num}},
            )

        batch_ms = int((time.time() - batch_start) * 1000)
        logger.info(
            f"ACNC batch {batch_num}/{total_batches}: {len(batch)} rows in {batch_ms}ms "
            f"(new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": FEED_NAME, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"ACNC upsert complete: {total_ms}ms — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": FEED_NAME, "duration_ms": total_ms}},
    )
    return stats


def scrape() -> None:
    """Entry point. Gated by FF_CHARITY_CHECK_INGEST so an accidental run on
    a fresh checkout (or a partially-configured CI environment) is a no-op.
    """
    if os.environ.get("FF_CHARITY_CHECK_INGEST", "").strip().lower() != "true":
        logger.info("FF_CHARITY_CHECK_INGEST not set to 'true' — skipping ACNC scrape")
        return

    start = time.time()
    error_msg: str | None = None
    status = "success"
    rows: list[dict] = []
    stats = {"new": 0, "updated": 0, "skipped": 0}

    try:
        logger.info(f"Fetching ACNC register (resource {RESOURCE_ID})")
        records = fetch_all_records()
        logger.info(f"Fetched {len(records)} ACNC records")

        for rec in records:
            row = transform_row(rec)
            if row is None:
                continue
            row["_hash"] = compute_row_hash(row)
            rows.append(row)
        dropped = len(records) - len(rows)
        logger.info(f"Transformed {len(rows)} valid rows ({dropped} dropped — null ABN/name)")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"ACNC fetch/transform failed: {e}")

    with get_db() as conn:
        if rows and status != "error":
            try:
                stats = upsert_charities(conn, rows)
                # No-op refresh (every row hashed-equal) reports as 'partial'
                # so the ingestion log distinguishes it from a fetch failure.
                if stats["new"] == 0 and stats["updated"] == 0:
                    status = "partial"
            except Exception as e:
                error_msg = str(e)
                status = "error"
                logger.error(f"ACNC upsert failed: {e}")

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(rows),
            records_new=stats["new"],
            records_updated=stats["updated"],
            records_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="charity",
        )

    logger.info(
        f"ACNC scrape complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
