-- migration-v10: Backfill feed_items categories using keyword matching
-- Classifies items with NULL or 'other' category based on title/description keywords

-- Phishing
UPDATE feed_items SET category = 'phishing'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(phishing|phish|fake email|spoofed email|credential)'
    OR lower(coalesce(description, '')) ~ '(phishing|phish|fake email|spoofed email)');

-- Romance scam
UPDATE feed_items SET category = 'romance_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(romance|dating|tinder|bumble|hinge|catfish|love scam|pig butchering|sugar mama|sugar daddy|sugar mommy)'
    OR lower(coalesce(description, '')) ~ '(romance|catfish|pig butchering|love scam)');

-- Investment fraud
UPDATE feed_items SET category = 'investment_fraud'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(investment|crypto|bitcoin|ethereum|trading|forex|stock|nft|ponzi|pyramid|passive income)'
    OR lower(coalesce(description, '')) ~ '(investment|crypto|bitcoin|trading|forex|ponzi)');

-- Tech support
UPDATE feed_items SET category = 'tech_support'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(tech support|microsoft|apple support|remote access|teamviewer|anydesk)'
    OR lower(coalesce(description, '')) ~ '(tech support|remote access|teamviewer|anydesk)');

-- Impersonation
UPDATE feed_items SET category = 'impersonation'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(impersonat|pretending to be|fake government|fake police|fake irs|fake ato|fake bank call|posing as)'
    OR lower(coalesce(description, '')) ~ '(impersonat|pretending to be|posing as)');

-- Shopping scam
UPDATE feed_items SET category = 'shopping_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(fake website|fake store|never arrived|fake shop|online shopping|marketplace|facebook marketplace)'
    OR lower(coalesce(description, '')) ~ '(fake website|fake store|fake shop|marketplace)');

-- Phone scam
UPDATE feed_items SET category = 'phone_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(phone call|phone scam|robocall|spoofed number|called me|voicemail|vishing)'
    OR lower(coalesce(description, '')) ~ '(phone call|phone scam|robocall|spoofed number)');

-- Email scam
UPDATE feed_items SET category = 'email_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(email scam|spam email|suspicious email|fake invoice|business email)'
    OR lower(coalesce(description, '')) ~ '(email scam|spam email|suspicious email|fake invoice)');

-- SMS scam
UPDATE feed_items SET category = 'sms_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(sms|text message|smishing|fake text|text scam)'
    OR lower(coalesce(description, '')) ~ '(sms|text message|smishing|text scam)');

-- Employment scam
UPDATE feed_items SET category = 'employment_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(job scam|employment|fake job|hiring scam|work from home|job offer|recruitment)'
    OR lower(coalesce(description, '')) ~ '(job scam|fake job|hiring scam|work from home)');

-- Advance fee
UPDATE feed_items SET category = 'advance_fee'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(advance fee|pay upfront|processing fee|clearance fee|inheritance|lottery winner|nigerian prince)'
    OR lower(coalesce(description, '')) ~ '(advance fee|pay upfront|processing fee|inheritance)');

-- Rental scam
UPDATE feed_items SET category = 'rental_scam'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(rental scam|rent scam|fake listing|apartment scam|deposit scam)'
    OR lower(coalesce(description, '')) ~ '(rental scam|rent scam|fake listing|apartment scam)');

-- Sextortion
UPDATE feed_items SET category = 'sextortion'
WHERE (category IS NULL OR category = 'other')
  AND (lower(title) ~ '(sextortion|blackmail|webcam|intimate|explicit)'
    OR lower(coalesce(description, '')) ~ '(sextortion|blackmail)');
