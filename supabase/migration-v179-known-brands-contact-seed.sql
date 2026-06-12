-- v179 — known_brands contact seed for the high-clone-volume watched brands.
--
-- Context: the clone-watch matcher watches ~212 AU brands, but known_brands
-- only had 19 emailable security contacts — so the highest-volume clone targets
-- (Target, Stake, Kmart, Qantas, …) were detected but had no brand-stewardship
-- recipient. This seeds the top ~20 by clone volume.
--
-- Verification model (paired with the send-route verified-gate):
--   * VERIFIED rows (last_verified_at set) come from the brand's own RFC 9116
--     security.txt — authoritative, safe for real sends.
--   * UNVERIFIED rows (last_verified_at NULL) are best-effort abuse@<domain>
--     placeholders so the brand surfaces in the SHADOW review now. The send
--     route only allows REAL-brand sends when last_verified_at IS NOT NULL, so
--     these can ONLY ever reach the shadow inbox until a human verifies the
--     real contact. Do NOT promote a row to verified without checking the
--     actual security contact.
--
-- Idempotent: ON CONFLICT (brand_name) DO NOTHING — never clobbers an existing
-- (possibly hand-curated) contact.

-- last_verified_at was NOT NULL (every legacy row was a hand-added verified
-- contact). Relax it so NULL can mean "unverified" — the state the send-route
-- verified-gate keys on. Existing rows keep their timestamps (still verified).
ALTER TABLE public.known_brands ALTER COLUMN last_verified_at DROP NOT NULL;

INSERT INTO public.known_brands
  (brand_name, brand_domain, brand_key, brand_category, contact_type,
   security_contact_email, is_active, last_verified_at, verified_by, source_url, notes)
VALUES
  -- ── Verified via security.txt (RFC 9116) ──────────────────────────────────
  ('Qantas', 'qantas.com.au', 'qantas', 'travel', 'email',
   'qantas-vdp-ess@submit.bugcrowd.com', true, now(), 'security_txt',
   'https://qantas.com.au/.well-known/security.txt', 'Verified via RFC 9116 security.txt (Bugcrowd VDP intake).'),
  ('iiNet', 'iinet.net.au', 'iinet', 'telco', 'email',
   'vulnerability@tpgtelecom.com.au', true, now(), 'security_txt',
   'https://iinet.net.au/.well-known/security.txt', 'Verified via RFC 9116 security.txt (TPG Telecom).'),
  ('Prospa', 'prospa.com', 'prospa', 'finance', 'email',
   'vulnerability.disclosure@prospa.com', true, now(), 'security_txt',
   'https://prospa.com/.well-known/security.txt', 'Verified via RFC 9116 security.txt.'),

  -- ── Best-effort abuse@<domain> — UNVERIFIED (shadow-only until checked) ────
  ('Target Australia', 'target.com.au', 'target_australia', 'retail', 'email', 'abuse@target.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Stake', 'hellostake.com', 'stake', 'finance', 'email', 'abuse@hellostake.com', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Kmart Australia', 'kmart.com.au', 'kmart_australia', 'retail', 'email', 'abuse@kmart.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Lendi', 'lendi.com.au', 'lendi', 'finance', 'email', 'abuse@lendi.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('ING Australia', 'ing.com.au', 'ing_australia', 'finance', 'email', 'abuse@ing.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Coles', 'coles.com.au', 'coles', 'retail', 'email', 'abuse@coles.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Revolut', 'revolut.com', 'revolut', 'finance', 'email', 'abuse@revolut.com', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Dominos Australia', 'dominos.com.au', 'dominos_australia', 'food', 'email', 'abuse@dominos.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('7-Eleven Australia', '7eleven.com.au', '7_eleven_australia', 'retail', 'email', 'abuse@7eleven.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('ubank', 'ubank.com.au', 'ubank', 'finance', 'email', 'abuse@ubank.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('McDonalds Australia', 'mcdonalds.com.au', 'mcdonalds_australia', 'food', 'email', 'abuse@mcdonalds.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Bonds', 'bonds.com.au', 'bonds', 'retail', 'email', 'abuse@bonds.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('HESTA', 'hesta.com.au', 'hesta', 'super', 'email', 'abuse@hesta.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Sendle', 'sendle.com', 'sendle', 'logistics', 'email', 'abuse@sendle.com', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Zeller', 'myzeller.com', 'zeller', 'finance', 'email', 'abuse@myzeller.com', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Belong', 'belong.com.au', 'belong', 'telco', 'email', 'abuse@belong.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.'),
  ('Domain', 'domain.com.au', 'domain', 'realestate', 'email', 'abuse@domain.com.au', true, NULL, NULL, NULL, 'UNVERIFIED placeholder — verify real security contact before real send.')
ON CONFLICT (brand_name) DO NOTHING;
