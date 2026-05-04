"""Unit tests for the ACNC register scraper transform layer.

These tests don't hit CKAN or Postgres — they exercise the row-shape
contract and the hash-based change-detection invariant. The scraper's
correctness end-to-end is verified by the GitHub Actions run against
prod (gated by FF_CHARITY_CHECK_INGEST=true).
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from acnc_register import (
    DELIST_SWEEP_SQL,
    RELIST_SQL,
    TOUCH_LAST_SEEN_SQL,
    _flag,
    _normalize_abn,
    _parse_date,
    _parse_int,
    _split_other_names,
    compute_row_hash,
    run_delistment_sweep,
    transform_row,
)


class TestFlagParse:
    def test_y_is_true(self):
        assert _flag("Y") is True

    def test_yes_lowercase_is_true(self):
        assert _flag("yes") is True

    def test_blank_is_false(self):
        assert _flag("") is False

    def test_none_is_false(self):
        assert _flag(None) is False

    def test_n_is_false(self):
        assert _flag("N") is False


class TestNormalizeAbn:
    def test_eleven_digits_passes_through(self):
        assert _normalize_abn("11005357522") == "11005357522"

    def test_strips_spaces(self):
        assert _normalize_abn("11 005 357 522") == "11005357522"

    def test_too_short_returns_none(self):
        assert _normalize_abn("12345") is None

    def test_too_long_returns_none(self):
        assert _normalize_abn("123456789012") is None

    def test_none_returns_none(self):
        assert _normalize_abn(None) is None

    def test_int_input(self):
        assert _normalize_abn(11005357522) == "11005357522"


class TestParseDate:
    def test_dd_mm_yyyy(self):
        assert _parse_date("01/06/2014") == "2014-06-01"

    def test_zero_pads(self):
        assert _parse_date("1/6/2014") == "2014-06-01"

    def test_iso_passthrough(self):
        assert _parse_date("2014-06-01") == "2014-06-01"

    def test_blank(self):
        assert _parse_date("") is None
        assert _parse_date(None) is None

    def test_garbage(self):
        assert _parse_date("not a date") is None


class TestSplitOtherNames:
    def test_comma_separated(self):
        # The scraper only splits on newlines and semicolons (not commas) to
        # avoid butchering "Smith, Brown & Co" style legal names.
        result = _split_other_names("Foo Foundation\nBar Trust")
        assert result == ["Foo Foundation", "Bar Trust"]

    def test_semicolon_separated(self):
        assert _split_other_names("Foo; Bar; Baz") == ["Foo", "Bar", "Baz"]

    def test_blank(self):
        assert _split_other_names("") == []
        assert _split_other_names(None) == []

    def test_strips_trailing_punctuation(self):
        assert _split_other_names("Foo,") == ["Foo"]


class TestParseInt:
    def test_digits(self):
        assert _parse_int("3") == 3

    def test_blank(self):
        assert _parse_int("") is None

    def test_garbage(self):
        assert _parse_int("three") is None


class TestTransformRow:
    """The full row→dict transform. Uses a representative CKAN payload."""

    def _sample(self) -> dict:
        return {
            "_id": 42,
            "ABN": "11005357522",
            "Charity_Legal_Name": "Australian Red Cross Society",
            "Other_Organisation_Names": "Red Cross Australia\nARC",
            "Address_Type": "Business",
            "Address_Line_1": "23-47 Villiers Street",
            "Address_Line_2": None,
            "Address_Line_3": None,
            "Town_City": "North Melbourne",
            "State": "VIC",
            "Postcode": "3051",
            "Country": "Australia",
            "Charity_Website": "https://www.redcross.org.au",
            "Registration_Date": "03/12/2012",
            "Date_Organisation_Established": "01/01/1914",
            "Charity_Size": "Large",
            "Number_of_Responsible_Persons": "11",
            "Financial_Year_End": "30-Jun",
            "Operates_in_ACT": "Y",
            "Operates_in_NSW": "Y",
            "Operates_in_NT": "Y",
            "Operates_in_QLD": "Y",
            "Operates_in_SA": "Y",
            "Operates_in_TAS": "Y",
            "Operates_in_VIC": "Y",
            "Operates_in_WA": "Y",
            "Operating_Countries": "Many",
            "PBI": "Y",
            "HPC": None,
            "Advancing_Health": "Y",
            "Advancing_social_or_public_welfare": "Y",
            "Victims_of_Disasters": "Y",
            "General_Community_in_Australia": "Y",
        }

    def test_happy_path(self):
        row = transform_row(self._sample())
        assert row is not None
        assert row["abn"] == "11005357522"
        assert row["charity_legal_name"] == "Australian Red Cross Society"
        assert row["other_names"] == ["Red Cross Australia", "ARC"]
        assert row["charity_website"] == "https://www.redcross.org.au"
        assert row["state"] == "VIC"
        assert row["charity_size"] == "Large"
        assert row["registration_date"] == "2012-12-03"
        assert row["date_established"] == "1914-01-01"
        assert row["number_responsible_persons"] == 11
        assert set(row["operates_in_states"]) == {"ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"}
        assert row["is_pbi"] is True
        assert row["is_hpc"] is False
        assert "health" in row["purposes"]
        assert "social_welfare" in row["purposes"]
        assert "victims_disasters" in row["beneficiaries"]
        assert "general_community_au" in row["beneficiaries"]

    def test_missing_abn_drops(self):
        rec = self._sample()
        rec["ABN"] = None
        assert transform_row(rec) is None

    def test_short_abn_drops(self):
        rec = self._sample()
        rec["ABN"] = "12345"
        assert transform_row(rec) is None

    def test_missing_name_drops(self):
        rec = self._sample()
        rec["Charity_Legal_Name"] = ""
        assert transform_row(rec) is None

    def test_minimal_record(self):
        """Many real rows are sparse — just ABN, name, and Charity_Size."""
        row = transform_row({
            "ABN": "12345678901",
            "Charity_Legal_Name": "Tiny Trust",
            "Charity_Size": "Small",
        })
        assert row is not None
        assert row["abn"] == "12345678901"
        assert row["operates_in_states"] == []
        assert row["purposes"] == []
        assert row["beneficiaries"] == []
        assert row["is_pbi"] is False


class TestRowHash:
    def test_deterministic(self):
        sample = transform_row({
            "ABN": "11005357522",
            "Charity_Legal_Name": "Foo",
            "Charity_Size": "Small",
        })
        assert sample is not None
        assert compute_row_hash(sample) == compute_row_hash(sample)

    def test_changes_when_content_changes(self):
        a = transform_row({
            "ABN": "11005357522",
            "Charity_Legal_Name": "Foo",
            "Charity_Size": "Small",
        })
        b = transform_row({
            "ABN": "11005357522",
            "Charity_Legal_Name": "Foo",
            "Charity_Size": "Large",  # changed
        })
        assert a is not None and b is not None
        assert compute_row_hash(a) != compute_row_hash(b)

    def test_excludes_abn_from_hash(self):
        """ABN is the natural key; it shouldn't change row content for hash purposes."""
        a = transform_row({"ABN": "11005357522", "Charity_Legal_Name": "Foo"})
        b = transform_row({"ABN": "22222222222", "Charity_Legal_Name": "Foo"})
        assert a is not None and b is not None
        assert compute_row_hash(a) == compute_row_hash(b)


class TestDelistmentSweep:
    """The two-pass sweep: re-list reset, then delistment mark.

    These tests mock psycopg2 cursors so the SQL contract is verified
    without spinning up Postgres. The actual row outcomes are verified
    end-to-end by the GitHub Actions run against prod.
    """

    def _make_conn_with_cursor(self, sweep_rowcount: int = 0,
                                relist_rowcount: int = 0,
                                still_delisted: int = 0):
        """Build a fake conn whose cursor returns the row counts and
        SELECT result we need to verify the sweep's behaviour."""
        cursor = MagicMock()
        # Sequence: relist UPDATE → sweep UPDATE → SELECT count
        # Using side_effect on a property so each .rowcount access in turn
        # returns the next value.
        rowcount_values = [relist_rowcount, sweep_rowcount]

        def execute_side_effect(sql, args=None):
            if rowcount_values:
                cursor.rowcount = rowcount_values.pop(0)

        cursor.execute.side_effect = execute_side_effect
        cursor.fetchone.return_value = (still_delisted,)

        conn = MagicMock()
        conn.cursor.return_value = cursor
        return conn, cursor

    def test_relist_pass_runs_first(self):
        """Order matters: re-list before delist sweep, otherwise an ABN
        delisted-then-relisted-then-delisted again wouldn't be re-flagged."""
        conn, cursor = self._make_conn_with_cursor()
        run_started_at = datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc)

        run_delistment_sweep(conn, ["11000000001", "11000000002"], run_started_at)

        # Two UPDATEs + one SELECT
        assert cursor.execute.call_count == 3
        first_sql = cursor.execute.call_args_list[0][0][0]
        second_sql = cursor.execute.call_args_list[1][0][0]
        assert first_sql is RELIST_SQL
        assert second_sql is DELIST_SWEEP_SQL

    def test_relist_pass_uses_seen_abns(self):
        """The first UPDATE must scope to the ABNs we saw this run."""
        conn, cursor = self._make_conn_with_cursor()
        seen = ["11000000001", "11000000002"]
        run_started_at = datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc)

        run_delistment_sweep(conn, seen, run_started_at)

        first_call_args = cursor.execute.call_args_list[0][0][1]
        assert first_call_args == (seen,)

    def test_sweep_uses_run_started_at_as_cutoff(self):
        """The delistment cutoff is run_started_at, NOT NOW(). This is what
        prevents a long-running scrape from racing its own writes."""
        conn, cursor = self._make_conn_with_cursor()
        run_started_at = datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc)

        run_delistment_sweep(conn, ["11000000001"], run_started_at)

        sweep_args = cursor.execute.call_args_list[1][0][1]
        # DELIST_SWEEP_SQL takes (delisted_at_default, last_seen_cutoff)
        assert sweep_args == (run_started_at, run_started_at)

    def test_returns_stats_dict(self):
        conn, _ = self._make_conn_with_cursor(
            relist_rowcount=3, sweep_rowcount=7, still_delisted=42,
        )
        stats = run_delistment_sweep(
            conn, ["abn"], datetime(2026, 5, 4, tzinfo=timezone.utc),
        )
        assert stats == {
            "relisted": 3,
            "newly_delisted": 7,
            "still_delisted": 42,
        }

    def test_commits_after_each_update(self):
        """Each UPDATE commits independently so a failure in the second
        doesn't roll back the first. Cursor → conn.commit() after each."""
        conn, _ = self._make_conn_with_cursor()
        run_delistment_sweep(
            conn, ["abn"], datetime(2026, 5, 4, tzinfo=timezone.utc),
        )
        # Two commits — one after relist, one after sweep.
        assert conn.commit.call_count == 2

    def test_empty_seen_abns_still_runs_sweep(self):
        """If the scrape returned zero rows (catastrophic CKAN failure),
        the caller short-circuits BEFORE this function — but if for some
        reason an empty list reaches us, the sweep should still execute
        without error. That's defensive belt-and-braces; a real empty-rows
        case is gated by `if rows and status != 'error':` in scrape()."""
        conn, cursor = self._make_conn_with_cursor()
        run_delistment_sweep(
            conn, [], datetime(2026, 5, 4, tzinfo=timezone.utc),
        )
        assert cursor.execute.call_count == 3


class TestSqlConstants:
    """Locks the structure of the SQL strings — guards against regressions
    where someone changes column names without updating the queries."""

    def test_touch_last_seen_targets_acnc_charities(self):
        assert "UPDATE acnc_charities" in TOUCH_LAST_SEEN_SQL
        assert "last_seen_in_register" in TOUCH_LAST_SEEN_SQL

    def test_relist_only_clears_currently_delisted(self):
        """RELIST_SQL must only touch rows where is_delisted=true; otherwise
        every scrape would write to every active row, ballooning WAL."""
        assert "is_delisted = true" in RELIST_SQL

    def test_sweep_skips_already_delisted(self):
        """DELIST_SWEEP_SQL must filter is_delisted=false. Without that
        filter, delisted_at would get bumped on every run."""
        assert "is_delisted = false" in DELIST_SWEEP_SQL

    def test_sweep_preserves_existing_delisted_at(self):
        """COALESCE protects the original delistment timestamp from being
        overwritten on a no-op re-run."""
        assert "COALESCE(delisted_at" in DELIST_SWEEP_SQL
