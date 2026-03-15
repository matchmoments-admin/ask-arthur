# Design System

Visual standards and component patterns for Ask Arthur. Reference this for all UI work across web, extension, and mobile.

---

## Brand Identity

| Property | Value |
|----------|-------|
| Name | Ask Arthur |
| Domain | askarthur.au |
| Tagline | Australia's scam detection platform |
| Tone | Trustworthy, clear, authoritative — like a government service but friendlier |
| Font | Public Sans (Google Fonts) |

## Color Tokens

All colors defined as CSS custom properties in `apps/web/app/globals.css`.

### Core

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-background` | `#ffffff` | Page background |
| `--color-foreground` | `#171717` | Primary text |
| `--color-deep-navy` | `#001F3F` | Headers, hero sections |
| `--color-navy` | `#002B45` | Secondary navy |
| `--color-action-teal` | `#008A98` | Buttons, links, accents |
| `--color-action-teal-text` | `#006B75` | Teal text on white backgrounds |

### Text & Borders

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-gov-slate` | `#42526E` | Primary body text |
| `--color-slate-500` | `#64748B` | Secondary text |
| `--color-slate-400` | `#94A3B8` | Muted text, placeholders |
| `--color-border-light` | `#E2E8F0` | Dividers, card borders |

### Verdict Colors

Three-tier verdict system used across all platforms:

| Verdict | Background | Border | Text | Heading |
|---------|-----------|--------|------|---------|
| SAFE | `#ECFDF5` | `#A7F3D0` | `#388E3C` | `#1B5E20` |
| SUSPICIOUS | `#FFF8E1` | `#FFE082` | `#F57C00` | `#E65100` |
| HIGH_RISK | `#FEF2F2` | `#FECACA` | `#D32F2F` | `#B71C1C` |

### Bot Platform Colors (Slack Block Kit)

| Verdict | Attachment Color |
|---------|-----------------|
| SAFE | `#22c55e` (green) |
| SUSPICIOUS | `#f59e0b` (amber) |
| HIGH_RISK | `#ef4444` (red) |

## Typography

### Web App

| Element | Size | Weight | Line Height | Notes |
|---------|------|--------|-------------|-------|
| Body | 18px | 400 | 1.6 | Public Sans |
| H1 | 2.5rem | 700 | 1.2 | letter-spacing: -0.02em |
| H2 | 2rem | 600 | 1.3 | letter-spacing: -0.01em |
| H3 | 1.5rem | 600 | 1.4 | |
| Small/Meta | 0.875rem | 400 | 1.5 | Slate-500 color |

### Blog Content

| Element | Size | Line Height | Notes |
|---------|------|-------------|-------|
| Body | 17px (1.0625rem) | 1.75 | Wider line height for readability |
| Headings | Standard scale | 1.3-1.4 | letter-spacing: -0.01em |
| Code blocks | — | — | SF Mono / Fira Code, bg: #f8fafc |
| Blockquotes | — | — | 3px teal left border, italic, no background |
| Table headers | — | — | Uppercase, letter-spacing: 0.0625rem |

### Code Fonts

```css
font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
```

## Layout & Spacing

### Content Widths

| Context | Max Width | Notes |
|---------|-----------|-------|
| General content | 640px | Standard page content |
| Blog content | 640px | Matches main content width |
| Hero sections | Full width | Navy background, contained content |
| Extension popup | 380px | Fixed width Chrome popup |

### Spacing Scale

Use Tailwind 4 spacing utilities. Prefer consistent spacing:

- Section gaps: `py-16` to `py-24`
- Card padding: `p-6` to `p-8`
- Element gaps: `gap-4` to `gap-6`
- Inline spacing: `gap-2` to `gap-3`

## Component Patterns

### Verdict Card

The primary result display used across web and extension:

```
┌─────────────────────────────────────┐
│ [Emoji] VERDICT (XX% confidence)    │  ← Verdict heading color
│                                     │
│ Summary text explaining the result  │  ← Body text color
│                                     │
│ 🚩 Red Flags:                       │
│ • Flag one                          │
│ • Flag two                          │
│                                     │
│ ✅ What to do:                      │
│ • Step one                          │
│ • Step two                          │
│                                     │
│ 📌 Type: phishing                   │
└─────────────────────────────────────┘
```

- Background, border, and text colors from verdict color tokens
- Rounded corners: `rounded-xl` (web), `rounded-2xl` (extension)
- Border: 1px solid verdict border color

### Phone Risk Report Card

Enrichment card displayed for SUSPICIOUS/HIGH_RISK verdicts when phone intelligence is available. Follows the DeepfakeGauge pattern (self-contained, feature-flagged).

```
┌──────────────────────────────────────────┐
│ [bg-slate-50 header]                     │
│ [phone_in_talk] PHONE RISK REPORT CARD   │
├──────────────────────────────────────────┤
│                                          │
│  Risk Score                     42/100   │
│  [████████████░░░░░░░░░░░░░░░░]          │
│  [MEDIUM badge]                          │
│                                          │
│  ┌──────────┬──────────┐                 │
│  │LINE TYPE │ CARRIER  │                 │
│  │  VoIP    │ Unknown  │                 │
│  ├──────────┼──────────┤                 │
│  │ COUNTRY  │ CALLER   │                 │
│  │  AU      │ Not Reg. │                 │
│  └──────────┴──────────┘                 │
│                                          │
│  ⚠ VoIP number — internet-based         │
│  ⚠ No registered caller name            │
│                                          │
│  Powered by Twilio Lookup                │
└──────────────────────────────────────────┘
```

**Risk level colors:**

| Score | Level | Color | Background |
|-------|-------|-------|------------|
| 0-19 | LOW | `#388E3C` | `#ECFDF5` |
| 20-39 | MEDIUM | `#F57C00` | `#FFF8E1` |
| 40-69 | HIGH | `#E65100` | `#FFF3E0` |
| 70-100 | CRITICAL | `#D32F2F` | `#FEF2F2` |

**Design tokens:**
- Header: `bg-slate-50 border-b border-slate-200`, text `text-xs font-bold uppercase tracking-widest text-deep-navy`
- Score bar: `w-full bg-gray-100 rounded-full h-3` (same as DeepfakeGauge)
- Signal grid: `grid grid-cols-2 sm:grid-cols-4 gap-3`, each cell `bg-slate-50 rounded-sm p-3 text-center`
- Warning items: Lucide `TriangleAlert` icon (`size={14}`, `text-[#F57C00]`) + `text-sm text-gov-slate`
- Risk badge: colored pill with `rounded-full px-2 py-0.5 text-xs font-bold uppercase`

**Files:** `apps/web/components/PhoneIntelCard.tsx`, `apps/mobile/components/PhoneIntelCard.tsx`

### Button Styles

| Type | Background | Text | Border |
|------|-----------|------|--------|
| Primary | `--color-action-teal` | White | None |
| Secondary | White | `--color-action-teal-text` | `--color-border-light` |
| Danger | Verdict HIGH_RISK bg | HIGH_RISK text | HIGH_RISK border |

- Border radius: `rounded-lg` (8px)
- Padding: `px-6 py-3` (standard), `px-4 py-2` (compact)
- Full-width CTAs: `w-full` on blog and marketing pages

### Input Fields

- Border: `--color-border-light`
- Focus ring: `--color-action-teal` with ring-2
- Border radius: `rounded-lg`
- Padding: `px-4 py-3`
- Placeholder color: `--color-slate-400`

### Cards

- Background: white
- Border: 1px `--color-border-light`
- Border radius: `rounded-xl`
- Shadow: `shadow-sm` (subtle)
- Padding: `p-6`

## Animations

### Spinner

```css
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
/* 1s linear infinite */
```

### Transitions

- Standard: `transition-all duration-200`
- Hover states: opacity or background-color changes
- Vaul drawer overlay: 0.2s opacity transition

## Chrome Extension

### Framework

- **WXT 0.20.0** with React + Tailwind
- System fonts (no Google Fonts loaded in extension context)

### Extension-Specific Tokens

| Property | Value |
|----------|-------|
| Popup width | 380px |
| Border radius | `rounded-2xl` (larger than web) |
| Tab control | Segmented tabs with active highlight |
| Loading | Spinner animation |

### Extension UI Components

- **Segmented tabs**: URL vs Text mode toggle
- **VerdictBadge**: Colored badge matching web verdict colors
- **ResultDisplay**: Compact verdict card for popup
- **ErrorState**: Rate limit and error messaging
- **LoadingSpinner**: Animated spinner during analysis

## Mobile App

### Framework

- **Expo 54 + React Native 0.81**
- Uses platform-native styling (not web CSS)

### Mobile Tokens

- Tab bar uses navy theme colors
- Icons: Ionicons set (Expo)
- Custom fonts loaded via `expo-font`
- Adaptive icon with navy background (Android)

## Provider Report Status Badges

Status badges for provider reporting workflows (v39). Used in admin/government dashboards.

| Status | Background | Text | Border |
|--------|-----------|------|--------|
| `queued` | `#F1F5F9` (slate-100) | `#475569` (slate-600) | `#CBD5E1` (slate-300) |
| `submitted` | `#DBEAFE` (blue-100) | `#1D4ED8` (blue-700) | `#93C5FD` (blue-300) |
| `acknowledged` | `#FEF3C7` (amber-100) | `#B45309` (amber-700) | `#FCD34D` (amber-300) |
| `actioned` | `#DCFCE7` (green-100) | `#15803D` (green-700) | `#86EFAC` (green-300) |
| `closed` | `#F3F4F6` (gray-100) | `#6B7280` (gray-500) | `#D1D5DB` (gray-300) |

**Pattern:** `rounded-full px-2.5 py-0.5 text-xs font-medium` (matches risk badge pattern)

## Financial Impact Display

Currency and loss amount rendering for financial impact tracking (v40).

**Formatting rules:**
- Currency: ISO 4217 code displayed before amount (e.g. `AUD $1,250.00`)
- Large amounts: Use locale formatting with thousands separators
- Zero/null: Display "No loss reported" in muted text (`text-slate-400`)
- Aggregates: Display total with count (e.g. `AUD $45,230 across 12 reports`)

**Display tokens:**
- Loss amount: `font-semibold text-lg` for individual, `text-2xl font-bold` for aggregates
- Currency code: `text-xs font-medium text-slate-500 uppercase tracking-wide`
- Loss trend (up): `text-red-600` with `TrendingUp` Lucide icon
- Loss trend (down): `text-green-600` with `TrendingDown` Lucide icon

## Responsive Breakpoints

Follow Tailwind defaults:

| Breakpoint | Width | Usage |
|------------|-------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Wide desktop |

## Video Embeds

- Responsive 16:9 container
- Full-width within content area
- Rounded corners matching card style

## Accessibility

- All interactive elements must be keyboard-accessible
- Verdict colors chosen for sufficient contrast ratios
- Focus indicators use teal ring (`ring-2 ring-action-teal`)
- Alt text required for all images
- Semantic HTML (headings hierarchy, landmark regions)
