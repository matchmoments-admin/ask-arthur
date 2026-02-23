"""Unit tests for IP and crypto address validation."""

from common.validate import validate_ip, ip_version, validate_eth_address, validate_btc_address


class TestValidateIP:
    """IP address validation."""

    def test_valid_ipv4(self):
        assert validate_ip("192.168.1.1") == "192.168.1.1"

    def test_valid_ipv4_with_whitespace(self):
        assert validate_ip("  10.0.0.1  ") == "10.0.0.1"

    def test_valid_ipv6(self):
        assert validate_ip("2001:db8::1") == "2001:db8::1"

    def test_valid_ipv6_full(self):
        result = validate_ip("2001:0db8:0000:0000:0000:0000:0000:0001")
        assert result == "2001:db8::1"  # Normalized form

    def test_invalid_ip(self):
        assert validate_ip("not-an-ip") is None

    def test_empty_string(self):
        assert validate_ip("") is None

    def test_ip_with_port(self):
        # IP with port is not a valid IP by itself
        assert validate_ip("192.168.1.1:8080") is None

    def test_ipv4_out_of_range(self):
        assert validate_ip("256.1.1.1") is None

    def test_ipv4_partial(self):
        assert validate_ip("192.168.1") is None


class TestIPVersion:
    """IP version detection."""

    def test_ipv4(self):
        assert ip_version("192.168.1.1") == 4

    def test_ipv6(self):
        assert ip_version("2001:db8::1") == 6

    def test_invalid(self):
        assert ip_version("not-an-ip") is None


class TestValidateETHAddress:
    """Ethereum address validation."""

    def test_valid_eth_lowercase(self):
        assert validate_eth_address("0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae") is True

    def test_valid_eth_mixed_case(self):
        assert validate_eth_address("0xDe0B295669a9FD93d5F28D9Ec85E40f4cb697BAe") is True

    def test_invalid_eth_no_prefix(self):
        assert validate_eth_address("de0b295669a9fd93d5f28d9ec85e40f4cb697bae") is False

    def test_invalid_eth_too_short(self):
        assert validate_eth_address("0xde0b295669a9fd93d5f28d9ec85e40f4cb697b") is False

    def test_invalid_eth_too_long(self):
        assert validate_eth_address("0xde0b295669a9fd93d5f28d9ec85e40f4cb697baee") is False

    def test_invalid_eth_non_hex(self):
        assert validate_eth_address("0xge0b295669a9fd93d5f28d9ec85e40f4cb697bae") is False

    def test_empty_string(self):
        assert validate_eth_address("") is False


class TestValidateBTCAddress:
    """Bitcoin address validation."""

    def test_valid_btc_legacy(self):
        # P2PKH address (starts with 1)
        assert validate_btc_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa") is True

    def test_valid_btc_p2sh(self):
        # P2SH address (starts with 3)
        assert validate_btc_address("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy") is True

    def test_valid_btc_bech32(self):
        # Bech32 address (starts with bc1)
        assert validate_btc_address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4") is True

    def test_invalid_btc_too_short(self):
        assert validate_btc_address("1A1zP1eP5QGefi2DMPTfTL5S") is False

    def test_invalid_btc_bad_prefix(self):
        assert validate_btc_address("2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa") is False

    def test_empty_string(self):
        assert validate_btc_address("") is False
