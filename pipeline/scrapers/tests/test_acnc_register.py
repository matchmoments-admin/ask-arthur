"""Unit tests for the ACNC register scraper transform layer.

These tests don't hit CKAN or Postgres — they exercise the row-shape
contract and the hash-based change-detection invariant. The scraper's
correctness end-to-end is verified by the GitHub Actions run against
prod (gated by FF_CHARITY_CHECK_INGEST=true).
"""

from acnc_register import (
    _flag,
    _normalize_abn,
    _parse_date,
    _parse_int,
    _split_other_names,
    compute_row_hash,
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
