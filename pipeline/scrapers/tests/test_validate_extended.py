"""Tests for extended validation — phone numbers and email addresses."""

from common.validate import validate_phone, validate_email


class TestValidatePhone:
    """Phone number normalization and validation."""

    def test_au_mobile(self):
        assert validate_phone("0412345678") == "+61412345678"

    def test_au_mobile_with_country_code(self):
        assert validate_phone("+61412345678") == "+61412345678"

    def test_au_mobile_no_plus(self):
        assert validate_phone("61412345678") == "+61412345678"

    def test_au_landline(self):
        assert validate_phone("0293456789") == "+61293456789"

    def test_au_with_spaces(self):
        assert validate_phone("0412 345 678") == "+61412345678"

    def test_au_with_dashes(self):
        assert validate_phone("0412-345-678") == "+61412345678"

    def test_au_with_parens(self):
        assert validate_phone("(04) 1234 5678") == "+61412345678"

    def test_international_phone(self):
        assert validate_phone("+14155551234") == "+14155551234"

    def test_invalid_phone(self):
        assert validate_phone("not-a-phone") is None

    def test_too_short(self):
        assert validate_phone("0412") is None

    def test_empty(self):
        assert validate_phone("") is None

    def test_whitespace_only(self):
        assert validate_phone("   ") is None


class TestValidateEmail:
    """Email address normalization and validation."""

    def test_valid_email(self):
        assert validate_email("test@example.com") == "test@example.com"

    def test_uppercase_normalized(self):
        assert validate_email("Test@Example.COM") == "test@example.com"

    def test_email_with_dots(self):
        assert validate_email("first.last@example.com") == "first.last@example.com"

    def test_email_with_plus(self):
        assert validate_email("user+tag@example.com") == "user+tag@example.com"

    def test_invalid_no_at(self):
        assert validate_email("notanemail") is None

    def test_invalid_no_domain(self):
        assert validate_email("user@") is None

    def test_invalid_no_tld(self):
        assert validate_email("user@domain") is None

    def test_empty(self):
        assert validate_email("") is None

    def test_whitespace_trimmed(self):
        assert validate_email("  test@example.com  ") == "test@example.com"
