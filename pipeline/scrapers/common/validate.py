"""Validation helpers for IP addresses and crypto wallet addresses."""

import ipaddress
import re


def validate_ip(raw_ip: str) -> str | None:
    """Validate and normalize an IP address (IPv4 or IPv6).

    Returns the string representation of the IP, or None if invalid.
    """
    try:
        addr = ipaddress.ip_address(raw_ip.strip())
        return str(addr)
    except (ValueError, AttributeError):
        return None


def ip_version(raw_ip: str) -> int | None:
    """Return 4 or 6 for the IP version, or None if invalid."""
    try:
        addr = ipaddress.ip_address(raw_ip.strip())
        return addr.version
    except (ValueError, AttributeError):
        return None


# ETH: 0x prefix + 40 hex characters (case-insensitive)
_ETH_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# BTC: 26-62 alphanumeric characters (covers legacy, SegWit, Bech32)
_BTC_RE = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,61}$|^bc1[a-zA-HJ-NP-Z0-9]{25,59}$")


def validate_eth_address(addr: str) -> bool:
    """Check if a string looks like a valid Ethereum address."""
    return bool(_ETH_RE.match(addr.strip()))


def validate_btc_address(addr: str) -> bool:
    """Check if a string looks like a valid Bitcoin address."""
    return bool(_BTC_RE.match(addr.strip()))
