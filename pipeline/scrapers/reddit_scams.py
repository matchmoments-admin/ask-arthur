"""Reddit r/Scams scraper — IOC extraction from scam report subreddits.

Data source: Reddit JSON API (multi-endpoint fallback) + RSS
IOCs extracted: URLs, phone numbers, email addresses, crypto wallet addresses
Rate limit: 10 req/min (7s delay between requests)

Endpoint priority:
  1. OAuth (oauth.reddit.com) — full data, requires credentials
  2. old.reddit.com JSON — full data, bypasses some cloud IP blocks
  3. www.reddit.com JSON — full data, known 403 on cloud IPs
  4. RSS feed — degraded data (no flair, no images, max ~25 posts)
"""

import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import NamedTuple

import requests

from common.db import (
    get_db,
    bulk_upsert_urls,
    bulk_upsert_crypto_wallets,
    bulk_upsert_entities,
    bulk_upsert_feed_items,
    log_ingestion,
    get_processed_reddit_posts,
    mark_reddit_posts_processed,
    cleanup_reddit_posts,
)
from common.r2 import upload_reddit_evidence
from common.logging_config import get_logger
from common.normalize import normalize_url
from common.validate import (
    validate_eth_address,
    validate_btc_address,
    validate_phone,
    validate_email,
)

logger = get_logger(__name__)

# ── Configuration ──

_REDDIT_JSON_BASE = "https://www.reddit.com/r/{subreddit}/new.json"
_REDDIT_OLD_JSON = "https://old.reddit.com/r/{subreddit}/new.json"
_REDDIT_OAUTH_BASE = "https://oauth.reddit.com/r/{subreddit}/new"
_REDDIT_RSS = "https://www.reddit.com/r/{subreddit}/new/.rss"
_USER_AGENT = "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)"
_REQUEST_DELAY_SECONDS = 7  # Stay under 10 req/min limit
_MAX_RETRIES = 2
_RETRY_BASE_DELAY = 3  # seconds
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}  # 403 is NOT retried

SUBREDDITS = [
    {"name": "Scams", "limit": 100},
    {"name": "phishing", "limit": 100},
    {"name": "scambait", "limit": 100},
    {"name": "AusFinance", "limit": 100},
]

# Flair-to-scam_type taxonomy mapping
# Includes both live Reddit flairs (2025+) and legacy flairs for backward compat.
FLAIR_MAP: dict[str, str] = {
    # ── Live r/Scams flairs ──
    "is this a scam?": "other",
    "scam report": "other",
    "help needed": "other",
    "victim of a scam": "other",
    "solved": "other",
    "informational post": "informational",
    # ── Live r/phishing flairs ──
    "gmail": "phishing",
    "hotmail": "phishing",
    "facebook": "phishing",
    "twitter": "phishing",
    "amazon": "phishing",
    "other": "phishing",
    # ── Live r/scambait flairs ──
    "completed bait": "other",
    "bait in progress": "other",
    "incomplete bait": "other",
    "funny": "other",
    "scambait question": "other",
    # ── Legacy flairs (backward compat) ──
    "phishing": "phishing",
    "smishing": "phishing",
    "vishing": "phishing",
    "investment scam": "investment_fraud",
    "crypto scam": "investment_fraud",
    "romance scam": "romance_scam",
    "pig butchering": "romance_scam",
    "tech support scam": "tech_support",
    "impersonation": "impersonation",
    "government impersonation": "impersonation",
    "shopping scam": "shopping_scam",
    "employment scam": "employment_scam",
    "job scam": "employment_scam",
    "advance fee": "advance_fee",
    "rental scam": "rental_scam",
    "sextortion": "sextortion",
}

# Australian keyword signals for geo-tagging
AU_KEYWORDS = [
    "ato", "centrelink", "mygov", "my gov", "medicare", "services australia",
    "telstra", "optus", "commbank", "commonwealth bank", "anz", "westpac", "nab",
    "australia post", "auspost", "woolworths", "coles", "bunnings",
    "+61", "com.au", ".gov.au", "abn", "tfn", "tax file number",
    "australian", "sydney", "melbourne", "brisbane", "perth", "adelaide",
]

# ── Country detection ──

# ISO 3166-1 alpha-2 codes (complete set)
VALID_COUNTRY_CODES: frozenset[str] = frozenset({
    "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT",
    "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
    "BJ", "BL", "BM", "BN", "BO", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
    "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO",
    "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO",
    "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM",
    "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM",
    "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN",
    "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS",
    "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP",
    "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT",
    "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML",
    "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX",
    "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR",
    "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN",
    "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA",
    "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN",
    "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG",
    "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
    "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN",
    "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
})

# Common aliases → canonical ISO alpha-2
_COUNTRY_ALIASES: dict[str, str] = {
    "UK": "GB",
    "USA": "US",
    "AUS": "AU",
    "CAN": "CA",
    "NZL": "NZ",
}

# Regex: [US], [UK], [AU], [USA] etc. in post titles
_COUNTRY_TAG_RE = re.compile(r"\[([A-Za-z]{2,3})\]")

# Subreddits with inherent country attribution
_SUBREDDIT_COUNTRY_MAP: dict[str, str] = {
    "ausfinance": "AU",
}


def _detect_country(title: str, subreddit: str) -> str | None:
    """Detect country from post title tag, subreddit default, or AU keyword fallback.

    Priority:
      1. Explicit title tag: [US], [UK], [AU] etc. — highest confidence
      2. Subreddit default: r/AusFinance → "AU"
      3. AU keyword fallback: _detect_au_relevance(title) — secondary only

    Returns ISO 3166-1 alpha-2 code or None.
    """
    # Layer 1: Title tag
    match = _COUNTRY_TAG_RE.search(title)
    if match:
        tag = match.group(1).upper()
        # Check alias first, then valid code
        code = _COUNTRY_ALIASES.get(tag, tag)
        if code in VALID_COUNTRY_CODES:
            return code

    # Layer 2: Subreddit default
    sub_lower = subreddit.lower()
    if sub_lower in _SUBREDDIT_COUNTRY_MAP:
        return _SUBREDDIT_COUNTRY_MAP[sub_lower]

    # Layer 3: AU keyword fallback
    if _detect_au_relevance(title):
        return "AU"

    return None


# Regex patterns for IOC extraction
_URL_RE = re.compile(
    r"https?://[^\s<>\"'\)\]\},]+",
    re.IGNORECASE,
)
_AU_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?61|0)[2-9]\d{7,8}(?!\d)",
)
_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
)
_ETH_RE = re.compile(r"0x[0-9a-fA-F]{40}")
_BTC_RE = re.compile(
    r"(?:[13][a-km-zA-HJ-NP-Z1-9]{25,61}|bc1[a-zA-HJ-NP-Z0-9]{25,59})",
)

# Reddit user mention pattern (PII scrubbing)
_USERNAME_RE = re.compile(r"(?:/?u/)\w+", re.IGNORECASE)

# URLs to skip (internal Reddit and common image hosts)
_SKIP_DOMAINS = {
    "reddit.com", "www.reddit.com", "old.reddit.com", "redd.it",
    "imgur.com", "i.imgur.com", "i.redd.it", "preview.redd.it", "v.redd.it",
    "giphy.com", "gfycat.com",
}


class ExtractedIOCs(NamedTuple):
    urls: list[dict]
    wallets: list[dict]
    phones: list[dict]
    emails: list[dict]


def _scrub_usernames(text: str) -> str:
    """Remove Reddit usernames before processing to avoid storing PII."""
    return _USERNAME_RE.sub("[REDACTED]", text)


def _detect_au_relevance(text: str) -> bool:
    """Check if post text contains Australian-specific signals."""
    text_lower = text.lower()
    return any(kw in text_lower for kw in AU_KEYWORDS)


def _map_flair(flair: str | None) -> str | None:
    """Map Reddit post flair to scam_type taxonomy."""
    if not flair:
        return None
    return FLAIR_MAP.get(flair.lower().strip())


def _should_skip_url(url: str) -> bool:
    """Check if URL is a Reddit-internal or image host link."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname
        return host is not None and host.lower() in _SKIP_DOMAINS
    except Exception:
        return False


def _extract_iocs(
    text: str,
    post_url: str,
    scam_type: str | None,
    feed_name: str,
    post_time: str | None = None,
    country_code: str | None = None,
) -> ExtractedIOCs:
    """Extract all IOC types from post text."""
    urls: list[dict] = []
    wallets: list[dict] = []
    phones: list[dict] = []
    emails: list[dict] = []

    seen_urls: set[str] = set()
    seen_wallets: set[str] = set()
    seen_phones: set[str] = set()
    seen_emails: set[str] = set()

    # Extract URLs
    for match in _URL_RE.findall(text):
        if _should_skip_url(match):
            continue
        normalized = normalize_url(match)
        if normalized and normalized.normalized not in seen_urls:
            seen_urls.add(normalized.normalized)
            urls.append({
                "url": match,
                "scam_type": scam_type,
                "feed_reported_at": post_time,
                "feed_reference_url": post_url,
                "country_code": country_code,
            })

    # Extract crypto wallets
    for match in _ETH_RE.findall(text):
        if match not in seen_wallets and validate_eth_address(match):
            seen_wallets.add(match)
            wallets.append({
                "address": match,
                "chain": "ETH",
                "scam_type": scam_type,
                "feed_reported_at": post_time,
                "feed_reference_url": post_url,
                "country_code": country_code,
            })
    for match in _BTC_RE.findall(text):
        if match not in seen_wallets and validate_btc_address(match):
            seen_wallets.add(match)
            wallets.append({
                "address": match,
                "chain": "BTC",
                "scam_type": scam_type,
                "feed_reported_at": post_time,
                "feed_reference_url": post_url,
                "country_code": country_code,
            })

    # Extract phone numbers (focus on Australian)
    for match in _AU_PHONE_RE.findall(text):
        validated = validate_phone(match)
        if validated and validated not in seen_phones:
            seen_phones.add(validated)
            phones.append({
                "entity_type": "phone",
                "normalized_value": validated,
                "feed_reference_url": post_url,
                "feed_reported_at": post_time,
                "country_code": country_code,
            })

    # Extract emails
    for match in _EMAIL_RE.findall(text):
        validated = validate_email(match)
        if validated and validated not in seen_emails:
            seen_emails.add(validated)
            emails.append({
                "entity_type": "email",
                "normalized_value": validated,
                "feed_reference_url": post_url,
                "feed_reported_at": post_time,
                "country_code": country_code,
            })

    return ExtractedIOCs(urls=urls, wallets=wallets, phones=phones, emails=emails)


# Domains that host direct images on Reddit
_IMAGE_DOMAINS = {"i.redd.it", "i.imgur.com", "preview.redd.it"}


def _extract_first_image(post: dict) -> str | None:
    """Extract the first image URL from a Reddit post dict.

    Checks in order:
    1. Direct image link in post url (i.redd.it, i.imgur.com, preview.redd.it)
    2. Reddit preview images
    3. Gallery posts via media_metadata
    Skips video posts entirely.
    """
    # Skip video posts
    if post.get("is_video", False):
        return None

    # 1. Direct image URL
    url = post.get("url", "") or ""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname
        if host and host.lower() in _IMAGE_DOMAINS:
            return url
    except Exception:
        pass

    # 2. Reddit preview images
    try:
        preview = post.get("preview")
        if preview and "images" in preview:
            images = preview["images"]
            if images:
                source = images[0].get("source", {})
                preview_url = source.get("url")
                if preview_url:
                    # Reddit HTML-encodes URLs in preview
                    return preview_url.replace("&amp;", "&")
    except Exception:
        pass

    # 3. Gallery posts (media_metadata)
    try:
        metadata = post.get("media_metadata")
        if metadata:
            for item in metadata.values():
                if item.get("status") == "valid" and item.get("e") == "Image":
                    source = item.get("s", {})
                    gallery_url = source.get("u")
                    if gallery_url:
                        return gallery_url.replace("&amp;", "&")
    except Exception:
        pass

    return None


def _get_oauth_token() -> str | None:
    """Get Reddit OAuth bearer token using app-only (client_credentials) flow.

    Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars.
    Returns None if credentials are not configured.
    """
    import os
    client_id = os.environ.get("REDDIT_CLIENT_ID")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    resp = requests.post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(client_id, client_secret),
        data={"grant_type": "client_credentials"},
        headers={"User-Agent": _USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("access_token")


# Module-level state (reset per test via _reset_fetch_state)
_oauth_token: str | None = None
_working_endpoint: str | None = None  # Cache which endpoint succeeded


def _reset_fetch_state() -> None:
    """Reset module-level fetch state. Used by tests."""
    global _oauth_token, _working_endpoint
    _oauth_token = None
    _working_endpoint = None


def _fetch_json_endpoint(
    url: str, params: dict, headers: dict,
) -> list[dict] | None:
    """Fetch posts from a single JSON endpoint with retry for transient errors.

    Returns list of post dicts on success, None on 403 (fast-fail to next tier).
    Raises on non-retryable errors after exhausting retries.
    """
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=60)
            if resp.status_code == 200:
                children = resp.json().get("data", {}).get("children", [])
                return [
                    child["data"]
                    for child in children
                    if child.get("kind") == "t3"
                ]
            if resp.status_code == 403:
                # 403 = blocked, don't retry — fall through to next endpoint
                return None
            if resp.status_code in _RETRYABLE_STATUSES and attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    f"Reddit {resp.status_code} from {url}, "
                    f"retrying in {delay}s (attempt {attempt + 1}/{_MAX_RETRIES})"
                )
                time.sleep(delay)
                continue
            # Non-retryable HTTP error
            resp.raise_for_status()
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_exc = e
            if attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    f"Reddit {type(e).__name__} from {url}, "
                    f"retrying in {delay}s (attempt {attempt + 1}/{_MAX_RETRIES})"
                )
                time.sleep(delay)
                continue
            raise

    # Exhausted retries on retryable status codes
    if last_exc:
        raise last_exc
    raise requests.RequestException(
        f"Failed after {_MAX_RETRIES} retries: {url}"
    )


def _extract_post_id_from_permalink(permalink: str) -> str:
    """Extract Reddit post ID from a permalink path.

    Example: '/r/Scams/comments/1abc123/some_title/' → '1abc123'
    """
    parts = permalink.strip("/").split("/")
    # permalink format: r/{sub}/comments/{id}/{slug}
    try:
        idx = parts.index("comments")
        return parts[idx + 1]
    except (ValueError, IndexError):
        return ""


def _fetch_rss_endpoint(subreddit: str, limit: int) -> list[dict] | None:
    """Fetch posts via RSS/Atom feed and normalize to JSON post dict shape.

    Returns list of post-like dicts on success, None on 403.
    Flair is always None (not in RSS). Image fields are absent.
    """
    url = _REDDIT_RSS.format(subreddit=subreddit)
    try:
        resp = requests.get(
            url, headers={"User-Agent": _USER_AGENT}, timeout=60,
        )
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        return None

    if resp.status_code == 403:
        return None
    if resp.status_code != 200:
        resp.raise_for_status()

    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError as e:
        logger.warning(f"RSS XML parse error for r/{subreddit}: {e}")
        return None

    # Atom namespace
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    entries = root.findall("atom:entry", ns)

    posts: list[dict] = []
    for entry in entries[:limit]:
        title_el = entry.find("atom:title", ns)
        content_el = entry.find("atom:content", ns)
        link_el = entry.find("atom:link", ns)
        updated_el = entry.find("atom:updated", ns)

        title = title_el.text if title_el is not None and title_el.text else ""
        # Content is HTML in Atom — strip tags for selftext equivalent
        raw_content = content_el.text if content_el is not None and content_el.text else ""
        selftext = html.unescape(re.sub(r"<[^>]+>", "", raw_content))

        permalink = ""
        if link_el is not None:
            href = link_el.get("href", "")
            # Extract path from full URL
            if href.startswith("https://www.reddit.com"):
                permalink = href[len("https://www.reddit.com"):]
            elif href.startswith("https://old.reddit.com"):
                permalink = href[len("https://old.reddit.com"):]

        post_id = _extract_post_id_from_permalink(permalink)

        created_utc = 0.0
        if updated_el is not None and updated_el.text:
            try:
                dt = datetime.fromisoformat(updated_el.text.replace("Z", "+00:00"))
                created_utc = dt.timestamp()
            except ValueError:
                pass

        posts.append({
            "id": post_id,
            "title": title,
            "selftext": selftext,
            "permalink": permalink,
            "link_flair_text": None,  # Not available in RSS
            "created_utc": created_utc,
            "url": "",  # No direct URL in RSS
        })

    return posts


def _fetch_subreddit_posts(subreddit: str, limit: int) -> list[dict]:
    """Fetch posts from a subreddit using cascading endpoint fallback.

    Priority: OAuth → old.reddit JSON → www.reddit JSON → RSS feed.
    Caches which endpoint works across subreddits within a scrape run.
    """
    global _oauth_token, _working_endpoint

    json_params = {"limit": limit, "raw_json": 1}
    public_headers = {"User-Agent": _USER_AGENT}

    # ── If we have a cached working endpoint, try it first ──
    if _working_endpoint:
        result = _try_endpoint(_working_endpoint, subreddit, limit, json_params, public_headers)
        if result is not None:
            return result
        # Cached endpoint failed — reset and try full chain
        logger.warning(
            f"Cached endpoint '{_working_endpoint}' failed for r/{subreddit}, "
            "retrying full chain"
        )
        _working_endpoint = None

    # ── Tier 1: OAuth ──
    if _oauth_token is None:
        try:
            _oauth_token = _get_oauth_token() or ""
        except Exception as e:
            logger.warning(f"OAuth token fetch failed: {e}")
            _oauth_token = ""

    if _oauth_token:
        url = _REDDIT_OAUTH_BASE.format(subreddit=subreddit)
        oauth_headers = {
            "User-Agent": _USER_AGENT,
            "Authorization": f"Bearer {_oauth_token}",
        }
        result = _fetch_json_endpoint(url, json_params, oauth_headers)
        if result is not None:
            _working_endpoint = "oauth"
            return result
        logger.warning("OAuth endpoint returned 403, trying old.reddit.com")

    # ── Tier 2: old.reddit.com JSON ──
    url = _REDDIT_OLD_JSON.format(subreddit=subreddit)
    result = _fetch_json_endpoint(url, json_params, public_headers)
    if result is not None:
        _working_endpoint = "old_json"
        return result
    logger.warning("old.reddit.com returned 403, trying www.reddit.com")

    # ── Tier 3: www.reddit.com JSON ──
    url = _REDDIT_JSON_BASE.format(subreddit=subreddit)
    result = _fetch_json_endpoint(url, json_params, public_headers)
    if result is not None:
        _working_endpoint = "www_json"
        return result
    logger.warning("www.reddit.com returned 403, trying RSS feed")

    # ── Tier 4: RSS feed (degraded) ──
    result = _fetch_rss_endpoint(subreddit, limit)
    if result is not None:
        _working_endpoint = "rss"
        logger.info(
            f"Using RSS feed for r/{subreddit} (degraded: no flair, no images, max ~25 posts)"
        )
        return result

    raise requests.RequestException(
        f"All Reddit endpoints failed for r/{subreddit}"
    )


def _try_endpoint(
    endpoint: str, subreddit: str, limit: int,
    json_params: dict, public_headers: dict,
) -> list[dict] | None:
    """Attempt fetch using a previously-cached endpoint name."""
    global _oauth_token
    if endpoint == "oauth" and _oauth_token:
        url = _REDDIT_OAUTH_BASE.format(subreddit=subreddit)
        oauth_headers = {
            "User-Agent": _USER_AGENT,
            "Authorization": f"Bearer {_oauth_token}",
        }
        return _fetch_json_endpoint(url, json_params, oauth_headers)
    elif endpoint == "old_json":
        url = _REDDIT_OLD_JSON.format(subreddit=subreddit)
        return _fetch_json_endpoint(url, json_params, public_headers)
    elif endpoint == "www_json":
        url = _REDDIT_JSON_BASE.format(subreddit=subreddit)
        return _fetch_json_endpoint(url, json_params, public_headers)
    elif endpoint == "rss":
        return _fetch_rss_endpoint(subreddit, limit)
    return None


def scrape() -> None:
    """Scrape Reddit scam subreddits for IOCs."""
    start = time.time()
    all_urls: list[dict] = []
    all_wallets: list[dict] = []
    all_entities: list[dict] = []  # phones + emails
    all_feed_items: list[dict] = []
    new_post_ids: list[tuple[str, str]] = []  # (post_id, subreddit)
    error_msg: str | None = None
    status = "success"
    total_posts = 0
    skipped_dedup = 0
    images_captured = 0

    try:
        # Load previously processed posts for dedup
        with get_db() as conn:
            processed_ids = get_processed_reddit_posts(conn)
        logger.info(f"Loaded {len(processed_ids)} previously processed post IDs")

        for i, sub_config in enumerate(SUBREDDITS):
            sub_name = sub_config["name"]
            limit = sub_config["limit"]

            logger.info(
                f"Fetching r/{sub_name} (limit={limit})",
                extra={"metadata": {"subreddit": sub_name}},
            )

            try:
                posts = _fetch_subreddit_posts(sub_name, limit)
            except requests.RequestException as e:
                logger.error(
                    f"Failed to fetch r/{sub_name}: {e}",
                    extra={"metadata": {"subreddit": sub_name}},
                )
                continue

            sub_urls = 0
            sub_wallets = 0
            sub_phones = 0
            sub_emails = 0
            post_count = 0
            sub_skipped = 0

            for post in posts:
                post_count += 1

                # Cross-run dedup: skip already-processed posts
                post_id = post.get("id", "")
                if post_id in processed_ids:
                    sub_skipped += 1
                    continue

                # Combine title + selftext for IOC extraction
                raw_text = f"{post.get('title', '')}\n{post.get('selftext', '')}"
                text = _scrub_usernames(raw_text)

                permalink = post.get("permalink", "")
                post_url = f"https://reddit.com{permalink}"
                flair = post.get("link_flair_text")
                scam_type = _map_flair(flair)

                created_utc = post.get("created_utc", 0)
                post_time = datetime.fromtimestamp(
                    created_utc, tz=timezone.utc
                ).isoformat()

                feed_name = f"reddit_r{sub_name.lower()}"
                country_code = _detect_country(post.get("title", ""), sub_name)
                iocs = _extract_iocs(text, post_url, scam_type, feed_name, post_time, country_code)

                # Evidence image capture
                evidence_r2_key = None
                image_url = _extract_first_image(post)
                if image_url:
                    evidence_r2_key = upload_reddit_evidence(image_url, post_id)
                    if evidence_r2_key:
                        images_captured += 1

                # Attach evidence_r2_key to entity IOCs
                if evidence_r2_key:
                    for entity in iocs.phones + iocs.emails:
                        entity["evidence_r2_key"] = evidence_r2_key

                all_urls.extend(iocs.urls)
                all_wallets.extend(iocs.wallets)
                all_entities.extend(iocs.phones)
                all_entities.extend(iocs.emails)

                # Build feed item for the public scam feed
                scrubbed_title = _scrub_usernames(post.get("title", ""))
                scrubbed_body = _scrub_usernames(post.get("selftext", ""))
                first_url = iocs.urls[0]["url"] if iocs.urls else None
                image_url_for_feed = _extract_first_image(post)

                all_feed_items.append({
                    "source": "reddit",
                    "external_id": post_id,
                    "title": scrubbed_title[:300],
                    "description": scrubbed_body[:500] if scrubbed_body else None,
                    "url": first_url,
                    "source_url": post_url,
                    "category": scam_type,
                    "channel": None,
                    "r2_image_key": evidence_r2_key,
                    "reddit_image_url": image_url_for_feed if not evidence_r2_key else None,
                    "impersonated_brand": None,
                    "country_code": country_code,
                    "upvotes": post.get("score", 0),
                    "verified": False,
                    "source_created_at": post_time,
                })

                sub_urls += len(iocs.urls)
                sub_wallets += len(iocs.wallets)
                sub_phones += len(iocs.phones)
                sub_emails += len(iocs.emails)

                new_post_ids.append((post_id, sub_name.lower()))

            skipped_dedup += sub_skipped
            total_posts += post_count
            logger.info(
                f"r/{sub_name}: {post_count} posts ({sub_skipped} skipped dedup) — "
                f"{sub_urls} URLs, {sub_wallets} wallets, "
                f"{sub_phones} phones, {sub_emails} emails",
                extra={"metadata": {"subreddit": sub_name}},
            )

            # Rate limit: delay between subreddit requests (skip after last)
            if i < len(SUBREDDITS) - 1:
                time.sleep(_REQUEST_DELAY_SECONDS)

        logger.info(
            f"Reddit fetch strategy: {_working_endpoint or 'none'}",
            extra={"metadata": {"endpoint": _working_endpoint or "none"}},
        )
        logger.info(
            f"Reddit total: {total_posts} posts across "
            f"{len(SUBREDDITS)} subreddits — "
            f"{skipped_dedup} skipped (dedup), {images_captured} images captured, "
            f"{len(all_urls)} URLs, {len(all_wallets)} wallets, "
            f"{len(all_entities)} entities (phones+emails)"
        )

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Reddit scrape failed: {e}")

    # Upsert to database
    with get_db() as conn:
        url_stats = {"new": 0, "updated": 0, "skipped": 0}
        wallet_stats = {"new": 0, "updated": 0, "skipped": 0}
        entity_stats = {"new": 0, "updated": 0, "skipped": 0}

        if all_urls:
            try:
                url_stats = bulk_upsert_urls(conn, all_urls, "reddit")
            except Exception as e:
                error_msg = str(e)
                status = "partial" if status != "error" else status
                url_stats = {"new": 0, "updated": 0, "skipped": len(all_urls)}
                logger.error(f"Reddit URL upsert failed: {e}")

        if all_wallets:
            try:
                wallet_stats = bulk_upsert_crypto_wallets(conn, all_wallets, "reddit")
            except Exception as e:
                error_msg = f"{error_msg or ''} | wallet: {e}"
                status = "partial" if status != "error" else status
                wallet_stats = {"new": 0, "updated": 0, "skipped": len(all_wallets)}
                logger.error(f"Reddit wallet upsert failed: {e}")

        if all_entities:
            try:
                entity_stats = bulk_upsert_entities(conn, all_entities, "reddit")
            except Exception as e:
                error_msg = f"{error_msg or ''} | entity: {e}"
                status = "partial" if status != "error" else status
                entity_stats = {"new": 0, "updated": 0, "skipped": len(all_entities)}
                logger.error(f"Reddit entity upsert failed: {e}")

        # Upsert feed items for the public scam feed
        if all_feed_items:
            try:
                feed_stats = bulk_upsert_feed_items(conn, all_feed_items, "reddit")
                logger.info(
                    f"Reddit feed items: {feed_stats['new']} new, "
                    f"{feed_stats['updated']} updated, {feed_stats['skipped']} skipped"
                )
            except Exception as e:
                logger.error(f"Reddit feed item upsert failed: {e}")

        # Mark new posts as processed for future dedup
        if new_post_ids:
            mark_reddit_posts_processed(conn, new_post_ids)

        # Cleanup old processed posts (>30 days)
        cleanup_reddit_posts(conn)

        duration_ms = int((time.time() - start) * 1000)

        total_new = url_stats["new"] + wallet_stats["new"] + entity_stats["new"]
        total_updated = url_stats["updated"] + wallet_stats["updated"] + entity_stats["updated"]
        total_skipped = url_stats["skipped"] + wallet_stats["skipped"] + entity_stats["skipped"]
        total_fetched = len(all_urls) + len(all_wallets) + len(all_entities)

        log_ingestion(
            conn,
            feed_name="reddit",
            status=status,
            records_fetched=total_fetched,
            records_new=total_new,
            records_updated=total_updated,
            records_skipped=total_skipped,
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="url",
        )

    logger.info(
        f"Reddit scrape complete: "
        f"URLs({url_stats['new']} new, {url_stats['updated']} upd) "
        f"Wallets({wallet_stats['new']} new, {wallet_stats['updated']} upd) "
        f"Entities({entity_stats['new']} new, {entity_stats['updated']} upd) "
        f"dedup_skipped={skipped_dedup}, images={images_captured} "
        f"in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
