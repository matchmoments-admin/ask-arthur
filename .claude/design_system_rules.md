# Ask Arthur — Design System Rules

## Brand Identity

- **Name**: Ask Arthur
- **Tagline**: Free AI Scam Checker
- **Voice**: Authoritative, trustworthy, approachable — like a knowledgeable friend who keeps you safe
- **Domain**: askarthur.ai

## Token Definitions

Design tokens are defined in `app/globals.css` using CSS custom properties inside `@theme inline`:

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-deep-navy` | `#001F3F` | Primary brand, headings, nav |
| `--color-navy` | `#002B45` | Secondary navy |
| `--color-action-teal` | `#008A98` | CTAs, links, accent highlights |
| `--color-gov-slate` | `#42526E` | Body text |
| `--color-slate-500` | `#64748B` | Secondary text |
| `--color-slate-400` | `#94A3B8` | Muted text, captions |
| `--color-border-light` | `#E2E8F0` | Borders, dividers |

### Verdict Colors

| State | Background | Border | Text | Heading |
|-------|-----------|--------|------|---------|
| Safe | `#ECFDF5` | `#A7F3D0` | `#388E3C` | `#1B5E20` |
| Suspicious | `#FFF8E1` | `#FFE082` | `#F57C00` | `#E65100` |
| High Risk | `#FEF2F2` | `#FECACA` | `#D32F2F` | `#B71C1C` |

### Typography

- **Font Family**: Public Sans (`--font-sans`)
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold)
- **Heading letter-spacing**: `-0.01em`

### Spacing & Layout

- Max content width: `640px` (centered)
- Horizontal padding: `20px` (`px-5`)
- Top accent bar: `6px` height (`h-1.5`) in `deep-navy`

## Component Library

Components are in `/components/`:

| Component | File | Purpose |
|-----------|------|---------|
| ScamChecker | `components/ScamChecker.tsx` | Main scam analysis input/output |
| ScamCounter | `components/ScamCounter.tsx` | Live stats counter |
| WaitlistForm | `components/WaitlistForm.tsx` | Email waitlist signup |
| SubscribeForm | `components/SubscribeForm.tsx` | Email subscription form |
| Footer | `components/Footer.tsx` | Site footer with nav links |

## Frameworks & Libraries

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 (with `@theme inline` tokens)
- **Icons**: Google Material Symbols Outlined (loaded via Google Fonts)
- **Analytics**: Plausible (privacy-first)

## Icon System

Icons use Material Symbols Outlined via CDN:
```html
<span className="material-symbols-outlined text-deep-navy text-4xl">icon_name</span>
```

Key icons used: `verified_user`, `bolt`, `shield`

## Styling Approach

- **Methodology**: Tailwind CSS utility classes
- **Global styles**: `app/globals.css` (tokens, focus states, animations)
- **Responsive**: Mobile-first with `md:` breakpoint for grid layouts
- **Focus states**: Custom ring using `rgba(0, 31, 63, 0.1)` shadow

## Project Structure

```
app/
  layout.tsx          # Root layout with metadata, fonts, analytics
  page.tsx            # Homepage (hero, scam checker, features, waitlist)
  globals.css         # Design tokens and global styles
  about/page.tsx      # About page
  api/                # API routes
components/           # Reusable UI components
lib/                  # Utilities (rate limiting, email, URL checking)
supabase/             # Database schema
```

## Brand Guidelines

### Logo Treatment
- Display as bold text: "Ask Arthur" in `deep-navy` with `font-extrabold text-lg uppercase tracking-wide`
- No `.ai` suffix in the logo — clean, human name

### Tone of Voice
- **Trustworthy**: Government-inspired authority without being cold
- **Simple**: Plain language explanations, no jargon
- **Caring**: Emphasis on protecting people, especially vulnerable users
- **Direct**: Clear verdicts — Safe, Suspicious, or High Risk

### Key Messaging
- "Got a suspicious message?"
- "We'll tell you if it's a scam — and exactly why."
- "Free, private, no signup required."

### Color Usage Rules
- Deep navy for authority and headings
- Action teal for interactive elements and CTAs
- Verdict colors ONLY for verdict states (never decorative)
- White background, minimal visual noise
