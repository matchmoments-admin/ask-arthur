"""Unit tests for the PFRA member-registry scraper.

These tests exercise the HTML-parse layer with miniature fixtures of the
two known PFRA page shapes. End-to-end correctness is verified by the
GitHub Actions weekly run against pfra.org.au (gated by
FF_CHARITY_CHECK_INGEST=true).
"""

from pfra_members import extract_member_names, normalize_name


CHARITY_PAGE_FIXTURE = """
<html>
<body>
<h4 class="card-title" id="card-title-1-1">Australian Red Cross</h4>
<h4 class="card-title" id="card-title-2-2">Cancer Council NSW</h4>
<h4 class="card-title" id="card-title-3-3">Médecins Sans Frontières Australia</h4>
<h4 class="card-title" id="card-title-4-4">&nbsp;</h4>
<h5>Quick Links</h5>
<h4 class="card-title" id="card-title-5-5">Foodbank NSW &amp; ACT</h4>
</body>
</html>
"""

AGENCY_PAGE_FIXTURE = """
<html>
<body>
<h4 style="text-align: left;"><span style="color: #86b421;">Cornucopia Consultancy</span></h4>
<h4 style="text-align: left;"><span style="color: #86b421;">Surge Direct</span></h4>
<h4 style="text-align: left;"><span style="color: #86b421;">Aida for Good</span></h4>
<h5>Contact Us</h5>
<h4 style="text-align: left;"><span style="color: #86b421;">The FIN Agency</span></h4>
</body>
</html>
"""


class TestExtractMemberNames:
    def test_charity_page_card_title_pattern(self):
        names = extract_member_names(CHARITY_PAGE_FIXTURE)
        assert "Australian Red Cross" in names
        assert "Cancer Council NSW" in names
        assert "Médecins Sans Frontières Australia" in names
        assert "Foodbank NSW & ACT" in names  # ampersand entity decoded

    def test_charity_page_filters_empty_h4(self):
        names = extract_member_names(CHARITY_PAGE_FIXTURE)
        # The &nbsp;-only h4 should be excluded
        assert "" not in names
        assert "\xa0" not in names

    def test_charity_page_excludes_h5_chrome(self):
        # h5 "Quick Links" should NOT be in results (only h4s are scanned)
        names = extract_member_names(CHARITY_PAGE_FIXTURE)
        assert "Quick Links" not in names

    def test_agency_page_span_pattern(self):
        names = extract_member_names(AGENCY_PAGE_FIXTURE)
        assert "Cornucopia Consultancy" in names
        assert "Surge Direct" in names
        assert "Aida for Good" in names
        assert "The FIN Agency" in names

    def test_filters_ui_noise(self):
        ui_noise_page = """
        <html><body>
        <h4>Quick Links</h4>
        <h4>Contact Us</h4>
        <h4>Charity Members</h4>
        <h4>What We Do</h4>
        <h4>Real Charity Name</h4>
        </body></html>
        """
        names = extract_member_names(ui_noise_page)
        assert names == ["Real Charity Name"]


class TestNormalizeName:
    def test_lowercase(self):
        assert normalize_name("Cancer Council") == "cancer council"

    def test_strips_ampersand(self):
        assert normalize_name("Foodbank NSW & ACT") == "foodbank nsw  act"

    def test_strips_apostrophes(self):
        assert normalize_name("St John's Ambulance") == "st johns ambulance"

    def test_strips_punctuation_keeps_alnum_and_space(self):
        assert normalize_name("Médecins Sans Frontières") == "mdecins sans frontires"
        # Note: accent characters strip — that's the trade-off for the SQL-
        # parity normalization. The ACNC join uses the same regex on its side
        # so both ends produce identical normalized forms.

    def test_collapses_to_lowercase_alnum_only(self):
        assert normalize_name("ABC, Inc. (Pty) Ltd!") == "abc inc pty ltd"
