"""ACCC Scamwatch news & alerts — HTML narrative scraper.

Source: https://www.scamwatch.gov.au/about-us/news-and-alerts/browse-news-and-alerts

The site has no public RSS — the historical /rss endpoint now returns 404
(verified 2026-05-06). This scraper hits the listing HTML, paginates via
?page=N, and extracts each article's metadata + body text.

Cadence: 3-hourly (highest-value AU regulator narrative).
License: Crown copyright, CC BY 4.0. Attribute "Source: ACCC Scamwatch".
"""
from __future__ import annotations

import hashlib
import re
import time
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from common.db import (
    bulk_upsert_narrative_feed_items,
    bulk_upsert_urls,
    get_db,
    log_ingestion,
)
from common.http_cache import conditional_get
from common.logging_config import get_logger
from common.normalize import normalize_url

logger = get_logger(__name__)

FEED_NAME = "scamwatch_alert"
LISTING = "https://www.scamwatch.gov.au/about-us/news-and-alerts/browse-news-and-alerts"
ORIGIN = "https://www.scamwatch.gov.au"
USER_AGENT = "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)"
MAX_PAGES = 3                # listing has ~10 items/page; 3 pages = ~30 newest articles
RATE_LIMIT_S = 2.0           # be polite to the Drupal backend
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
BRAND_HINTS = [
    "ATO", "myGov", "Centrelink", "Medicare", "Australia Post", "AusPost",
    "CommBank", "ANZ", "Westpac", "NAB", "Telstra", "Optus", "Qantas",
    "Amazon", "Netflix", "PayPal",
]


def _hash_external_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


def _fetch(url: str) -> str | None:
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=45)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.warning(f"scamwatch fetch failed for {url}: {e}")
        return None


def _list_article_urls(listing_html: str) -> list[str]:
    soup = BeautifulSoup(listing_html, "html.parser")
    seen: set[str] = set()
    urls: list[str] = []
    for a in soup.select("a[href*='/about-us/news-and-alerts/']"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        full = urljoin(ORIGIN, href)
        # Skip the listing page itself / pagination links / anchor links.
        if "/browse-news-and-alerts" in full:
            continue
        if full in seen:
            continue
        seen.add(full)
        urls.append(full)
    return urls


def _parse_article(article_url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1")
    if not h1:
        return None
    title = h1.get_text(strip=True)
    if not title:
        return None

    # Drupal exposes Dublin Core metadata as <meta> tags.
    pub = (
        soup.find("meta", attrs={"name": "dcterms.created"})
        or soup.find("meta", attrs={"property": "article:published_time"})
    )
    pub_at = pub.get("content").strip() if pub and pub.get("content") else None

    summary_meta = soup.find("meta", attrs={"name": "description"})
    summary = (
        summary_meta.get("content").strip()
        if summary_meta and summary_meta.get("content")
        else None
    )

    og_image = soup.find("meta", attrs={"property": "og:image"})
    image_url = og_image.get("content").strip() if og_image and og_image.get("content") else None

    keywords_meta = soup.find("meta", attrs={"name": "keywords"})
    tags = []
    if keywords_meta and keywords_meta.get("content"):
        tags = [t.strip() for t in keywords_meta["content"].split(",") if t.strip()]

    body_div = soup.find("div", class_="content") or soup.find("article")
    body_text = body_div.get_text("\n", strip=True) if body_div else ""

    impersonated = next(
        (b for b in BRAND_HINTS if b.lower() in title.lower() or b.lower() in body_text.lower()),
        None,
    )

    return {
        "source": "scamwatch_alert",
        "external_id": _hash_external_id(article_url),
        "title": title,
        "description": (summary or body_text[:500]).strip() or None,
        "body_md": body_text[:8000] if body_text else None,
        "url": article_url,
        "source_url": article_url,
        "category": _infer_category(title, body_text),
        "country_code": "AU",
        "impersonated_brand": impersonated,
        "tags": tags,
        "published_at": pub_at,
        "source_created_at": pub_at,
        "evidence_r2_key": None,  # R2 image upload is a follow-up; URL goes to feed_items.r2_image_key separately if needed
        "provenance_tier": "official",
        # Out-of-band: pass image_url so the URL extractor sees it but it's not stored on feed_items.
        "_image_url": image_url,
    }


def _infer_category(title: str, body: str) -> str:
    text = f"{title} {body}".lower()
    if any(w in text for w in ("phish", "fake email", "fake sms")):
        return "phishing"
    if any(w in text for w in ("invest", "crypto", "bitcoin", "ponzi")):
        return "investment_fraud"
    if any(w in text for w in ("romance", "dating")):
        return "romance_scam"
    if any(w in text for w in ("tech support", "remote access")):
        return "tech_support"
    if any(w in text for w in ("impersonat", "ato", "mygov", "government")):
        return "impersonation"
    if any(w in text for w in ("shopping", "online store", "fake product")):
        return "shopping_scam"
    if any(w in text for w in ("job", "employment", "recruit")):
        return "employment_scam"
    return "other"


def _extract_urls(article: dict) -> Iterable[dict]:
    body = article.get("body_md") or ""
    seen: set[str] = set()
    for m in URL_PATTERN.findall(body):
        clean = m.rstrip(".,);:'\"")
        if clean in seen:
            continue
        seen.add(clean)
        yield {
            "url": clean,
            "scam_type": article.get("category") or "other",
            "brand": article.get("impersonated_brand"),
            "feed_reference_url": article.get("url"),
            "country_code": "AU",
        }


def scrape() -> None:
    start = time.time()
    error_msg: str | None = None
    status = "success"
    items: list[dict] = []
    all_urls: list[dict] = []
    fetched = 0

    try:
        # Listing page — use conditional GET to skip if Drupal returns 304.
        resp = conditional_get(FEED_NAME, LISTING, user_agent=USER_AGENT)
        if resp.not_modified:
            logger.info("Scamwatch listing 304 — nothing new")
            article_urls: list[str] = []
        else:
            article_urls = _list_article_urls(resp.text)

        # Paginate up to MAX_PAGES (only if listing changed).
        for page_num in range(1, MAX_PAGES):
            page_url = f"{LISTING}?page={page_num}"
            time.sleep(RATE_LIMIT_S)
            html = _fetch(page_url)
            if not html:
                break
            extra = _list_article_urls(html)
            article_urls.extend(u for u in extra if u not in article_urls)

        logger.info(f"Scamwatch: {len(article_urls)} candidate articles")

        for url in article_urls:
            time.sleep(RATE_LIMIT_S)
            html = _fetch(url)
            if not html:
                continue
            article = _parse_article(url, html)
            if not article:
                continue
            fetched += 1
            article.pop("_image_url", None)  # not a feed_items column
            items.append(article)
            all_urls.extend(_extract_urls(article))
    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Scamwatch scrape failed: {e}")

    with get_db() as conn:
        item_stats = (
            bulk_upsert_narrative_feed_items(conn, items, FEED_NAME)
            if items
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        url_stats = (
            bulk_upsert_urls(conn, all_urls, FEED_NAME)
            if all_urls
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=fetched,
            records_new=item_stats["new"],
            records_updated=item_stats["updated"],
            records_skipped=item_stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="feed_item",
        )
    logger.info(
        f"Scamwatch complete: items new={item_stats['new']} updated={item_stats['updated']}, "
        f"urls new={url_stats['new']}, {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
