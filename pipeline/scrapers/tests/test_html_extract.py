"""Tests for common/html_extract.py.

These are smoke-shape tests: confirm that the trafilatura wrapper
(a) returns non-empty text for a realistic AU-gov article shape,
(b) preserves inline anchor URLs (the #238 lesson translated to Python),
(c) caps output at MAX_BODY_LEN,
(d) returns empty string for empty / non-article input rather than None.

The tests don't pin every word of trafilatura's output — that varies
slightly between minor versions. They pin the *contract* this codebase
relies on.
"""
from __future__ import annotations

from common.html_extract import MAX_BODY_LEN, extract_article_body


SCAMWATCH_LIKE_HTML = """
<!DOCTYPE html>
<html><head><title>Scamwatch — Sample alert</title></head>
<body>
  <header><nav>Nav links</nav></header>
  <main>
    <article>
      <h1>Beware fake myGov text-message scams targeting Australians</h1>
      <p>The ACCC is warning that scammers are sending SMS messages that impersonate
      myGov. Recipients are urged not to click any link. See
      <a href="https://www.scamwatch.gov.au/protect-yourself/attempts-to-gain-your-personal-information/identity-theft">the official guidance</a>
      for more information.</p>
      <p>Affected Australians can report incidents to
      <a href="https://www.scamwatch.gov.au/report-a-scam">Scamwatch</a>.</p>
    </article>
  </main>
  <footer>Footer / share / nav</footer>
</body></html>
"""

NASC_LIKE_FUSION_CELL = """
<!DOCTYPE html>
<html><body>
  <article>
    <h1>NASC Fusion Cell update — investment scams Q1 2026</h1>
    <p>The National Anti-Scam Centre's investment-scam Fusion Cell reports
    losses of A$94m in Q1 2026, driven by deepfake celebrity-endorsement
    crypto scams. Details at <a href="https://www.nasc.gov.au/fusion-cell-q1-2026">the full report</a>.</p>
  </article>
</body></html>
"""


def test_extracts_main_article_body_from_scamwatch_like_page():
    out = extract_article_body(SCAMWATCH_LIKE_HTML, "https://www.scamwatch.gov.au/example")
    assert out, "trafilatura should extract a non-empty body from this shape"
    assert "myGov" in out
    assert "ACCC" in out
    # Nav and footer should be stripped.
    assert "Nav links" not in out
    assert "Footer / share" not in out


def test_anchor_urls_survive_extraction_issue_238_class():
    """Anchor hrefs must appear in the extracted text — same class of bug
    as #238 in the Cloudflare Worker. trafilatura with include_links=True
    writes them inline as markdown links."""
    out = extract_article_body(SCAMWATCH_LIKE_HTML)
    # The href should appear somewhere in the output (markdown or
    # plain-text — we don't pin the exact formatting trafilatura uses).
    assert "scamwatch.gov.au/protect-yourself/attempts-to-gain-your-personal-information/identity-theft" in out
    assert "scamwatch.gov.au/report-a-scam" in out


def test_extracts_nasc_fusion_cell_body():
    out = extract_article_body(NASC_LIKE_FUSION_CELL)
    assert "Fusion Cell" in out
    assert "A$94m" in out
    assert "nasc.gov.au/fusion-cell-q1-2026" in out


def test_returns_empty_string_for_empty_input():
    assert extract_article_body("") == ""
    assert extract_article_body("   ") == ""


def test_returns_empty_string_for_non_article_html():
    # A bare <html><body><div>x</div></body></html> with no article shape
    # trafilatura should return either nothing or near-nothing — we accept
    # either as "no real body" semantically. The helper's contract is that
    # the *return type* is always str, never None.
    result = extract_article_body("<html><body><div>x</div></body></html>")
    assert isinstance(result, str)


def test_respects_max_body_len_cap():
    # Build an article whose extracted text would exceed MAX_BODY_LEN.
    # trafilatura preserves repeated paragraphs unless deduplicate=True
    # kills them — so make each para slightly different.
    paras = "\n".join(
        f"<p>Paragraph number {i} contains unique content about scam variant {i}.</p>"
        for i in range(2000)  # ~120k chars before extraction
    )
    big_html = f"<html><body><article><h1>Big article</h1>{paras}</article></body></html>"
    out = extract_article_body(big_html)
    assert len(out) <= MAX_BODY_LEN, f"output {len(out)} > cap {MAX_BODY_LEN}"
