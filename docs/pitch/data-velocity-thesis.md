# Data Velocity Thesis

## The Flywheel

Ask Arthur's core competitive advantage is **data velocity** — the speed at which we accumulate, process, and distribute scam threat intelligence. Each consumer interaction produces a data point that improves the platform for everyone.

```
Consumer submits check
        │
        ▼
AI analysis (Claude Haiku)
        │
        ├── Verdict returned to user (instant value)
        │
        └── HIGH_RISK → verified_scams table
                │
                ├── Trending threats API (B2B value)
                ├── Weekly blog content (SEO value)
                ├── Email digest (retention value)
                └── Pattern training data (detection value)
```

## Unit Economics

### Cost per Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Claude Haiku (input) | ~$0.0002 | ~500 tokens avg input |
| Claude Haiku (output) | ~$0.0004 | ~300 tokens avg output |
| URL reputation checks | ~$0.0001 | Google Safe Browsing (free tier) |
| Supabase storage | ~$0.0001 | Per record, negligible |
| **Total per check** | **~$0.0008** | **Less than $0.001** |

### Value per Threat Data Point

| Revenue Source | Value per data point | Calculation |
|----------------|---------------------|-------------|
| B2B API (Pro tier) | ~$0.20 | $2K/mo ÷ 10K calls/day |
| B2B API (Enterprise) | ~$0.50-1.50 | $5-15K/mo ÷ 10K calls/day |
| SEO traffic (ads equiv.) | ~$0.05 | Blog post CPM equivalent |
| **Blended value** | **~$0.25** | At scale with 10 API customers |

### Margin

At scale: **$0.001 cost → $0.25 value = 250x return per data point**

This is the "Have I Been Pwned" economics — the cost of data collection is near-zero (users bring data to you), while the value of aggregated intelligence compounds.

## Comparison to US Threat Intel Companies

| Company | Model | Data Source | Pricing |
|---------|-------|------------|---------|
| Have I Been Pwned | Breach database | User reports + breaches | Free (consumer) + paid API |
| Recorded Future | Threat intel platform | Web scraping + OSINT | $100K+/yr enterprise |
| PhishLabs | Phishing intel | Email traps + customer data | $50K+/yr |
| **Ask Arthur** | **Scam intel platform** | **Community-sourced checks** | **$24K-$180K/yr** |

Our advantage: **community-sourced data is real-time and reflects actual threats reaching real people**, not honeypots or web scraping.

## Growth Metrics (Series A Targets)

To raise a Series A ($3-5M), we need to demonstrate:

| Metric | Target | Why It Matters |
|--------|--------|---------------|
| MAU (consumer) | 50,000+ | Proves consumer product-market fit |
| Checks/day | 5,000+ | Data velocity metric for investors |
| Verified scams catalogued | 10,000+ | Size of threat intelligence database |
| API customers (paid) | 5-10 | B2B revenue validation |
| ARR | $200K+ | Revenue trajectory |
| Detection accuracy | >90% | Model quality metric |
| NPS | >50 | User satisfaction |

## The Compounding Effect

Month 1: 100 checks/day → 50 verified scams → basic trend data
Month 6: 1,000 checks/day → 500 verified scams/mo → reliable weekly trends
Month 12: 5,000 checks/day → 2,500 verified scams/mo → comprehensive threat landscape
Month 24: 20,000 checks/day → 10,000 verified scams/mo → **Australia's definitive scam database**

Each month, our dataset becomes harder to replicate. A competitor starting today would need 24 months of community-sourced data to match our database.

## Revenue Projections

| Timeline | Consumer MAU | API Customers | ARR |
|----------|-------------|---------------|-----|
| Month 6 | 5,000 | 0 | $0 |
| Month 12 | 20,000 | 2 | $48K |
| Month 18 | 50,000 | 5 | $200K |
| Month 24 | 100,000 | 10 | $600K |
| Month 36 | 250,000 | 20 | $2M |

Assumes average API customer value of $5K/mo (blended across tiers).
