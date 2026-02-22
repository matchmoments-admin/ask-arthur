"""URL normalization — mirrors packages/scam-engine/src/url-normalize.ts exactly.

Same logic: lowercase scheme+hostname, strip tracking params, strip fragments,
decode path, strip trailing slash. Uses tldextract (Python equivalent of tldts).
"""

from urllib.parse import urlparse, parse_qs, urlencode, unquote
from dataclasses import dataclass
import tldextract

TRACKING_PARAMS = frozenset(
    [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "ref",
        "source",
        "campaign",
    ]
)


@dataclass
class NormalizedURL:
    normalized: str
    domain: str
    subdomain: str | None
    tld: str
    full_path: str


def normalize_url(raw_url: str) -> NormalizedURL | None:
    """Normalize a URL for deduplication and storage.

    Returns None for invalid or non-HTTP URLs.
    Produces identical output to the TypeScript normalizeURL() function.
    """
    try:
        parsed = urlparse(raw_url)
    except Exception:
        return None

    # Only allow http/https
    if parsed.scheme.lower() not in ("http", "https"):
        return None

    if not parsed.hostname:
        return None

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()

    # Strip tracking params
    params = parse_qs(parsed.query, keep_blank_values=True)
    filtered_params = {
        k: v for k, v in params.items() if k.lower() not in TRACKING_PARAMS
    }

    # Rebuild query string (sorted for consistency with JS URLSearchParams)
    search = urlencode(filtered_params, doseq=True) if filtered_params else ""

    # Decode path
    try:
        path = unquote(parsed.path) if parsed.path else "/"
    except Exception:
        path = parsed.path or "/"

    # Ensure path starts with /
    if not path.startswith("/"):
        path = "/" + path

    # Strip trailing slash (unless path is just "/")
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    # Extract domain components using tldextract
    ext = tldextract.extract(hostname)
    domain = f"{ext.domain}.{ext.suffix}" if ext.suffix else hostname
    subdomain = ext.subdomain or None
    tld = f".{ext.suffix}" if ext.suffix else ""

    # Build normalized URL
    search_part = f"?{search}" if search else ""
    normalized = f"{scheme}://{hostname}{path}{search_part}"
    full_path = f"{path}{search_part}"

    return NormalizedURL(
        normalized=normalized,
        domain=domain,
        subdomain=subdomain,
        tld=tld,
        full_path=full_path,
    )
