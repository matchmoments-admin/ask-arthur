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


# Phone: Australian mobile/landline or international with + prefix
_AU_PHONE_RE = re.compile(r"^(?:\+?61|0)[2-9]\d{7,8}$")
_INTL_PHONE_RE = re.compile(r"^\+[1-9]\d{6,14}$")

# Basic email validation
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def validate_phone(raw: str) -> str | None:
    """Normalize and validate a phone number.

    Returns E.164 format (e.g. +61412345678) or None if invalid.
    Australian numbers starting with 0 are converted to +61.
    """
    cleaned = re.sub(r"[\s\-\(\).]", "", raw.strip())
    if not cleaned:
        return None

    if _AU_PHONE_RE.match(cleaned):
        # Normalize AU numbers to +61 format
        if cleaned.startswith("0"):
            cleaned = "+61" + cleaned[1:]
        elif cleaned.startswith("61") and not cleaned.startswith("+"):
            cleaned = "+" + cleaned
        return cleaned

    if _INTL_PHONE_RE.match(cleaned):
        return cleaned

    return None


def validate_email(raw: str) -> str | None:
    """Validate and normalize an email address. Returns lowercase or None."""
    email = raw.strip().lower()
    if not email:
        return None
    if _EMAIL_RE.match(email):
        return email
    return None
