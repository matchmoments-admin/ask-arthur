"""Standardized HTML → text body extraction for narrative scrapers.

Why this exists: every HTML-scrape scraper in Phase B (NASC, ACMA,
Services Australia) needs to convert article HTML into clean body text
for `feed_items.body_md`. Without a shared helper, each scraper rolls
its own regex / BeautifulSoup combo — and the inbound-email Worker
showed how that goes wrong (#238: stripping <a> tags drops the href).

Wraps trafilatura (https://trafilatura.readthedocs.io/) so every
scraper produces consistent output:
  * inline anchor URLs preserved as `[label](url)` markdown
  * boilerplate (nav, footer, share buttons) stripped
  * length-capped at MAX_BODY_LEN to match feed_items.body_md size

Not used by RSS scrapers — feedparser already gives them clean text.

When the helper isn't right: a source whose article body sits inside a
non-standard tag (e.g. a JSON blob in a <script type=application/ld+json>)
needs custom parsing. trafilatura returns "" in that case — the caller
should fall back to source-specific extraction rather than embed empty
rows.
"""

from __future__ import annotations

from typing import Optional

import trafilatura

# Matches the feed_items.body_md size check (50 KB). Trafilatura output
# is typically much smaller — this is a defence against pathological
# pages and a paste-from-Word body that bloats with whitespace.
MAX_BODY_LEN = 50_000


def extract_article_body(html: str, source_url: Optional[str] = None) -> str:
    """Extract main article text from an HTML page.

    Returns the trafilatura-extracted body with anchor URLs preserved
    inline as markdown. Empty string if extraction fails — caller should
    treat as "skip this article" rather than store an empty row.

    Args:
        html: raw HTML bytes/str fetched from the source.
        source_url: optional canonical URL — helps trafilatura's heuristics
            decide what's main-content vs. navigation. Pass when available.

    Returns:
        UTF-8 text body (markdown-formatted), capped at MAX_BODY_LEN.
        Empty string if no article body could be extracted.
    """
    if not html:
        return ""

    text = trafilatura.extract(
        html,
        url=source_url,
        include_links=True,
        include_formatting=False,
        deduplicate=True,
        favor_precision=True,
        no_fallback=False,
    )

    if not text:
        return ""

    return text.strip()[:MAX_BODY_LEN]
