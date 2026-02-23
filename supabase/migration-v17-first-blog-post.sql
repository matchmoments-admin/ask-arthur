-- migration-v17-first-blog-post.sql
-- Seed the first blog post: Ask Arthur launch announcement

INSERT INTO blog_posts (
  slug,
  title,
  subtitle,
  excerpt,
  content,
  author,
  tags,
  status,
  category,
  is_featured,
  reading_time_minutes,
  seo_title,
  meta_description,
  published_at,
  created_at
) VALUES (
  '2026-02-23-why-we-built-ask-arthur',
  'Why We Built Ask Arthur: Australia Deserves Better Scam Protection',
  'Australians lost $2.03 billion to scams in 2024. We decided to do something about it.',
  'Australians lost $2.03 billion to scams last year and existing tools aren''t built for us. Here''s why we created Ask Arthur — and how it works.',
  E'If you live in Australia, you''ve almost certainly received a dodgy text this week. Maybe it was a fake toll road notice from "Linkt," a parcel delivery you never ordered, or a message from "myGov" threatening to suspend your account. You''re not imagining it — it really is getting worse.\n\nAustralians lost **$2.03 billion to scams in 2024**. Let that number sink in for a moment. That''s not some abstract figure — it''s retirement savings wiped out, small businesses gutted, and real people left wondering how they didn''t see it coming.\n\nHere''s the thing that keeps us up at night: scam reports actually *dropped* 20% in 2025, but **losses per victim climbed 5%**. Scammers aren''t sending more messages — they''re getting *better* at the ones they send. The average loss reported to Scamwatch hit **$12,212** in the first half of 2025.\n\n> [!DANGER]\n> AI-powered scams are accelerating fast. Scammers now need just **3 seconds of audio** to clone someone''s voice, and 70% of people can''t tell the difference. Deepfake vishing attacks jumped 1,600% in early 2025.\n\n## The gap nobody was filling\n\nAustralia passed the **Scams Prevention Framework Act** in February 2025 — the world''s toughest anti-scam legislation, with penalties up to $50 million per offence for non-compliant banks, telcos, and platforms. The government is taking this seriously.\n\nBut here''s the gap: if you receive a suspicious message *right now*, what do you actually do? Scamwatch lets you report it — after the fact. Norton''s tools are built for the US market. Your bank''s fraud team can''t tell you whether that SMS is real before you click.\n\nThere was no Australian-made, consumer-first tool that could look at a message and tell you in seconds whether it''s a scam. So we built one.\n\n## Meet Arthur\n\nAsk Arthur is dead simple by design. **Screenshot a suspicious message, paste a dodgy URL, or type out that weird email** — and Arthur tells you whether it''s a scam, what kind, and what to do next. No signup required. No app to download. Just answers.\n\nUnder the hood, Arthur is powered by AI trained on real Australian scam data — the specific patterns, brands, and tactics scammers use to target people in this country. It knows about the fake Linkt texts, the myGov impersonations, the Afterpay phishing campaigns, and hundreds of other active scam patterns.\n\n> [!TIP]\n> **You can try Ask Arthur right now** at [askarthur.au](https://askarthur.au). Paste any suspicious message, URL, or email and get an instant analysis. It''s free and you don''t need to create an account.\n\n## Why "Arthur"?\n\nWe wanted a name that felt like a trusted mate — someone you''d actually turn to when something felt off. Not a corporate security product, not a government acronym. Just a straight-talking friend who happens to know a lot about scams.\n\nAnd like any good mate, Arthur doesn''t collect what he doesn''t need. We''re upfront about what data we store and — more importantly — **what we don''t**. Your screenshots aren''t saved. Your personal details aren''t harvested. Arthur''s here to help, not to build a profile on you.\n\n## What''s coming next\n\nThis launch is just the beginning. Here''s what we''re working on:\n\n- **Weekly scam alerts** — Australia-specific roundups of the latest threats, published right here on this blog\n- **A community-sourced scam database** — real reports from real Australians, verified and searchable\n- **A threat intelligence API** — so banks, telcos, and platforms can protect their customers with real-time Australian scam data\n\n> [!WARNING]\n> **42% of Australians won''t answer their phone anymore** because they assume it''s a scam. When trust in basic communication breaks down, the cost isn''t just financial — it''s social. That''s what we''re fighting to fix.\n\n## How you can help\n\nThe single most useful thing you can do right now? **Try Arthur with a real suspicious message** and share it with someone you care about. Your mum, your nan, your mate who keeps clicking on things. Scam awareness is great, but scam *tools* are better — because even cybersecurity experts get caught out.\n\n(Seriously — Troy Hunt, the Australian security legend who created Have I Been Pwned, fell for a phishing attack in 2025. If it can happen to him, "just be careful" isn''t enough.)\n\nWelcome to Ask Arthur. Let''s make scammers'' lives harder, together.\n\n---\n\n*Ask Arthur is Australia''s first community-sourced scam intelligence platform. Try it free at [askarthur.au](https://askarthur.au).*',
  'Ask Arthur',
  '["launch", "ask-arthur", "scams", "australia", "scam-prevention"]'::jsonb,
  'published',
  'news',
  true,
  4,
  'Why We Built Ask Arthur | Australia''s Free Scam Checker',
  'Australians lost $2.03 billion to scams in 2024. Ask Arthur is the free, Australian-made tool that checks any message for scams in seconds. No signup needed.',
  NOW(),
  NOW()
);
