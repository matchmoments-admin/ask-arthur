# Design System

Visual standards and component patterns for Ask Arthur. Reference this for all UI work across web, extension, and mobile.

---

## Brand Identity

| Property | Value                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| Name     | Ask Arthur                                                                   |
| Domain   | askarthur.au                                                                 |
| Tagline  | Australia's scam detection platform                                          |
| Tone     | Trustworthy, clear, authoritative — like a government service but friendlier |
| Font     | Public Sans (Google Fonts)                                                   |

## Color Tokens

All colors defined as CSS custom properties in `apps/web/app/globals.css`.

### Core

| Token                      | Hex       | Usage                                                                                                                                                                                           |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-background`       | `#ffffff` | Page background                                                                                                                                                                                 |
| `--color-foreground`       | `#171717` | Primary text                                                                                                                                                                                    |
| `--color-deep-navy`        | `#001F3F` | **Primary** — buttons, links, focus rings, headers, hero sections (auth + dashboard + marketing)                                                                                                |
| `--color-navy`             | `#002B45` | Secondary navy                                                                                                                                                                                  |
| `--color-action-teal`      | `#008A98` | **Legacy** — retained for verdict/scanner UI and a small number of marketing surfaces. **Do NOT use for new auth, dashboard, or general primary CTAs.** Default primary is `--color-deep-navy`. |
| `--color-action-teal-text` | `#006B75` | **Legacy** — same caveat as above                                                                                                                                                               |

> **Primary direction (2026-04 onward):** navy is the primary action colour across auth (`/login`, `/signup`) and the dashboard (`/app/*`). Teal is being retired from those surfaces. New components should never reach for `action-teal` for buttons or focus rings; use `deep-navy` instead. Existing teal usage on verdict cards (SAFE/SUSPICIOUS/HIGH_RISK), the Persona Check tile hover, and a few marketing pages is acceptable transitional state.

### Safe variant — auth + dashboard surfaces

The Safe variant (Stripe-clean refinement, shipped in PRs #35 and #39) introduced a small palette of neutral surface tokens used by `apps/web/app/(auth)/*` and `apps/web/app/app/*`. These are written as literal hex values inline (not yet promoted to CSS custom properties — promote when reused outside the dashboard/auth surfaces).

| Literal               | Usage                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `#fbfbfa`             | Cream backdrop — auth page background, dashboard sidebar background, dashboard main background           |
| `#eef0f3`             | 1px borders on dashboard cards, sidebar, topbar — slightly warmer than `--color-border-light`            |
| `#f8fafc`             | Subtle inset surface — persona-pill bar, SPF principle tile, activity icon tile, "all clear" empty state |
| `#f1f5f9`             | Hover/active state on sidebar nav items (paired with `text-deep-navy`)                                   |
| `#94a3b8`             | Group labels, mono axis ticks, subdued meta — uppercase 10–11px usage                                    |
| `#64748b`             | Body slate text on dashboard surfaces                                                                    |
| `#475569`             | Inactive sidebar nav item label                                                                          |
| `#16a34a` / `#dc2626` | Delta pill foreground (green up / red down). Background `#f0fdf4` / `#fef2f2`.                           |

### Text & Borders

| Token                  | Hex       | Usage                    |
| ---------------------- | --------- | ------------------------ |
| `--color-gov-slate`    | `#42526E` | Primary body text        |
| `--color-slate-500`    | `#64748B` | Secondary text           |
| `--color-slate-400`    | `#94A3B8` | Muted text, placeholders |
| `--color-border-light` | `#E2E8F0` | Dividers, card borders   |

### Verdict Colors

Three-tier verdict system used across all platforms:

| Verdict    | Background | Border    | Text      | Heading   |
| ---------- | ---------- | --------- | --------- | --------- |
| SAFE       | `#ECFDF5`  | `#A7F3D0` | `#388E3C` | `#1B5E20` |
| SUSPICIOUS | `#FFF8E1`  | `#FFE082` | `#F57C00` | `#E65100` |
| HIGH_RISK  | `#FEF2F2`  | `#FECACA` | `#D32F2F` | `#B71C1C` |

### Bot Platform Colors (Slack Block Kit)

| Verdict    | Attachment Color  |
| ---------- | ----------------- |
| SAFE       | `#22c55e` (green) |
| SUSPICIOUS | `#f59e0b` (amber) |
| HIGH_RISK  | `#ef4444` (red)   |

## Typography

### Web App

| Element    | Size     | Weight | Line Height | Notes                   |
| ---------- | -------- | ------ | ----------- | ----------------------- |
| Body       | 18px     | 400    | 1.6         | Public Sans             |
| H1         | 2.5rem   | 700    | 1.2         | letter-spacing: -0.02em |
| H2         | 2rem     | 600    | 1.3         | letter-spacing: -0.01em |
| H3         | 1.5rem   | 600    | 1.4         |                         |
| Small/Meta | 0.875rem | 400    | 1.5         | Slate-500 color         |

### Blog Content

| Element       | Size             | Line Height | Notes                                       |
| ------------- | ---------------- | ----------- | ------------------------------------------- |
| Body          | 17px (1.0625rem) | 1.75        | Wider line height for readability           |
| Headings      | Standard scale   | 1.3-1.4     | letter-spacing: -0.01em                     |
| Code blocks   | —                | —           | SF Mono / Fira Code, bg: #f8fafc            |
| Blockquotes   | —                | —           | 3px teal left border, italic, no background |
| Table headers | —                | —           | Uppercase, letter-spacing: 0.0625rem        |

### Code Fonts

```css
font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
```

## Layout & Spacing

### Content Widths

| Context         | Max Width  | Notes                              |
| --------------- | ---------- | ---------------------------------- |
| General content | 640px      | Standard page content              |
| Blog content    | 640px      | Matches main content width         |
| Hero sections   | Full width | Navy background, contained content |
| Extension popup | 380px      | Fixed width Chrome popup           |

### Spacing Scale

Use Tailwind 4 spacing utilities. Prefer consistent spacing:

- Section gaps: `py-16` to `py-24`
- Card padding: `p-6` to `p-8`
- Element gaps: `gap-4` to `gap-6`
- Inline spacing: `gap-2` to `gap-3`

## Marketing Page Layout

Rules for every consumer-facing top-level page (`/about`, `/health`, `/persona-check`, `/scam-feed`, `/blog`, `/terms`, `/privacy`, and similar). The canonical examples are `/health` (Scanner) and `/persona-check` — mirror those.

### Page shell (non-negotiable)

Every marketing page uses this skeleton:

```tsx
<div className="min-h-screen flex flex-col">
  <Nav />
  <main
    id="main-content"
    className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
  >
    <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
      {/* Page title */}
    </h1>
    <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
      {/* One-sentence subtitle, neutral tone */}
    </p>
    {/* Page content — sections flow in the same 640px column */}
  </main>
  <Footer />
</div>
```

**Key properties:**

- **Container width: `max-w-[640px]`** for the entire `main`. Not `max-w-prose`, not `max-w-2xl`, not `max-w-3xl`. Section-level inner containers do not override this — they inherit.
- **Horizontal padding: `px-5`** (20px). Applied once at `main`, not repeated per section.
- **Vertical padding: `pt-16 pb-16`**. Sections inside use `mb-16` or `mb-20` for rhythm, never their own `py-16`.
- **Page title: `h1` centred, `text-4xl md:text-5xl font-extrabold`, colour `text-deep-navy`, `leading-tight`, `mb-4`**. One `h1` per page. No coloured hero background behind it.
- **Subtitle: `p` centred, `text-lg text-gov-slate mb-10 leading-relaxed`**. One sentence, neutral, no marketing voice.
- **Section headings (`h2`): centred, `text-2xl md:text-3xl font-extrabold text-deep-navy mb-3`**. Lead paragraph below is centred, same `gov-slate` colour.

### Forbidden patterns

These have caused drift on the About page in the past. Do not use on marketing pages:

- **Full-bleed coloured section backgrounds** (`bg-slate-50`, `bg-white border-b border-border-light` used as a section separator). Marketing pages are white end-to-end. Dashboard pages (`/app/*`) may use surface colours; marketing pages may not.
- **Multiple container widths within one page** (`max-w-prose`, then `max-w-2xl`, then `max-w-3xl`). Pick 640px and stay there.
- **Inline pull-quotes styled as mini-headings** (`text-xl md:text-2xl font-semibold` in the middle of a paragraph block). If a sentence needs emphasis, bold it inline. We do not use pull-quotes.
- **Section-level `py-16 px-5 border-b`**. The main container owns vertical and horizontal spacing; sections only own margin-between.
- **Per-section `max-w-*` overrides** (e.g. a section using `max-w-prose` because its prose "needs it"). If the copy feels cramped at 640px, the copy is too long — rewrite it, don't widen the page.

### Typography anchors

- **H1:** `text-4xl md:text-5xl font-extrabold text-deep-navy leading-tight`
- **H2:** `text-2xl md:text-3xl font-extrabold text-deep-navy`
- **Lead paragraph under H1:** `text-lg text-gov-slate leading-relaxed`
- **Lead paragraph under H2:** default size `text-gov-slate leading-relaxed`
- **Body copy:** default, `text-gov-slate leading-relaxed`, no colour overrides
- **Small meta text:** `text-sm text-slate-500` or `text-xs text-slate-400`

Italics are allowed for editorial voice (e.g. the founder note on `/about`). Never use italics for UI labels or metadata.

### Card / list pattern

When listing items (tools, categories, options), use the pattern from `PersonaChecker.tsx`:

```tsx
<a
  href={...}
  className="block p-4 bg-white border border-border-light rounded-xl hover:border-action-teal/40 hover:shadow-sm transition-all"
>
  <div className="flex items-start gap-4">
    <Icon size={22} className="text-action-teal shrink-0 mt-1" />
    <div>
      <p className="font-semibold text-deep-navy">{label}</p>
      <p className="text-sm text-gov-slate mt-1 leading-relaxed">{desc}</p>
    </div>
  </div>
</a>
```

Not `rounded-2xl`, not `shadow-md`, not `hover:-translate-y-0.5`. The Persona Check card is the canonical pattern.

### Exceptions (closed list)

The following pages are allowed to deviate from the 640px rule. **Do not add more without a written justification in this table.**

| Page                 | Allowed width   | Reason                                                                     |
| -------------------- | --------------- | -------------------------------------------------------------------------- |
| `/banking`           | `max-w-[960px]` | B2B landing page with side-by-side product/value-prop copy                 |
| `/telco`             | `max-w-[960px]` | B2B landing page                                                           |
| `/digital-platforms` | `max-w-[960px]` | B2B landing page                                                           |
| `/scam-map`          | `max-w-3xl`     | World choropleth needs horizontal room; shrinking makes the map unreadable |
| `/app/*`             | varies          | Dashboard — different surface, different rules (not a marketing page)      |

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

| Score  | Level    | Color     | Background |
| ------ | -------- | --------- | ---------- |
| 0-19   | LOW      | `#388E3C` | `#ECFDF5`  |
| 20-39  | MEDIUM   | `#F57C00` | `#FFF8E1`  |
| 40-69  | HIGH     | `#E65100` | `#FFF3E0`  |
| 70-100 | CRITICAL | `#D32F2F` | `#FEF2F2`  |

**Design tokens:**

- Header: `bg-slate-50 border-b border-slate-200`, text `text-xs font-bold uppercase tracking-widest text-deep-navy`
- Score bar: `w-full bg-gray-100 rounded-full h-3` (same as DeepfakeGauge)
- Signal grid: `grid grid-cols-2 sm:grid-cols-4 gap-3`, each cell `bg-slate-50 rounded-sm p-3 text-center`
- Warning items: Lucide `TriangleAlert` icon (`size={14}`, `text-[#F57C00]`) + `text-sm text-gov-slate`
- Risk badge: colored pill with `rounded-full px-2 py-0.5 text-xs font-bold uppercase`

**Files:** `apps/web/components/PhoneIntelCard.tsx`, `apps/mobile/components/PhoneIntelCard.tsx`

### Button Styles

| Type                                       | Background            | Text                | Border           |
| ------------------------------------------ | --------------------- | ------------------- | ---------------- |
| Primary (auth + dashboard + new work)      | `--color-deep-navy`   | White               | None             |
| Primary (legacy verdict / older marketing) | `--color-action-teal` | White               | None             |
| Secondary                                  | White                 | `--color-deep-navy` | `#e2e8f0`        |
| Danger                                     | Verdict HIGH_RISK bg  | HIGH_RISK text      | HIGH_RISK border |

- Border radius: `rounded-lg` (8px) on marketing surfaces; `8px` (`borderRadius: 8`) on auth/dashboard
- Padding: `px-6 py-3` (standard marketing), `px-3 py-2.5` (auth forms), `px-3 py-2` (dashboard topbar / inline)
- Full-width CTAs: `w-full` on blog, marketing pages, and auth forms
- Subtle shadow on navy primary in auth: `0 1px 2px rgba(0,31,63,0.18)`

### Input Fields

| Surface          | Border                 | Focus                                     | Radius       | Padding     |
| ---------------- | ---------------------- | ----------------------------------------- | ------------ | ----------- |
| Auth + dashboard | `1px solid #e2e8f0`    | `#001F3F` ring (via global `input:focus`) | `8px`        | `10px 12px` |
| Marketing forms  | `--color-border-light` | `--color-action-teal` ring-2              | `rounded-lg` | `px-4 py-3` |

Placeholder color: `--color-slate-400`. Auth input labels are `text-[13px] font-medium text-deep-navy mb-1.5` — note this is lighter than marketing's `font-bold` style.

### Cards

Two patterns coexist depending on surface:

**Marketing cards** (used on `/about`, `/health`, etc.):

- Background: white
- Border: 1px `--color-border-light` (`#E2E8F0`)
- Border radius: `rounded-xl` (12px)
- Shadow: `shadow-sm` (subtle)
- Padding: `p-6`

**Dashboard / auth cards** (Safe variant — `/app/*`, `/login`, `/signup`):

- Background: white
- Border: `1px solid #eef0f3` (warmer than border-light; written inline)
- Border radius: `10px` (KPI cards), `12px` (section cards), `14px` (auth form card)
- Shadow: **none** by default; auth form gets a faint `0 1px 2px rgba(15,23,42,0.04)`
- Padding: `18px` (KPI), `22px` (section card), `32px 32px 28px` (auth form)
- Section cards include an internal `header` block with title (`15px font-semibold text-deep-navy tracking-tight`), subtitle (`12px text-slate-500`), and an optional `action` slot (right-aligned link or button)

Do not mix patterns within a single page. Marketing pages keep `shadow-sm`; dashboard pages drop shadows in favour of crisp 1px `#eef0f3` borders.

## Dashboard Surfaces (Safe Variant)

Rules for `/app/*` and `/login`, `/signup`. Distinct from marketing-page rules (above) — different backdrop, different chrome, different typography rhythm. The Safe variant was shipped in PRs #35 and #39 and is now the canonical look for authenticated surfaces.

### Backdrop

- Page background: `#fbfbfa` (cream — warmer than pure white). Set on the auth layout root and the dashboard `<main>` container.
- Card surface: white (`#ffffff`).
- Subtle inset (e.g. persona pill bar, activity icon tile): `#f8fafc`.

### Sidebar (`DashboardSidebar.tsx`)

- Width: `236px` (desktop). Mobile uses a slide-out drawer with the same chrome at `w-72`.
- Background: `#fbfbfa`. Right border `1px solid #eef0f3`.
- Brand mark: navy `28×28` shield tile (`borderRadius: 7`) + wordmark `askArthur` (`14px font-semibold tracking-tight`) + org/region line (`11px text-slate-500`).
- Nav groups: `Workspace` and `Account`. Group labels are `10px font-semibold uppercase tracking-wider text-slate-400`, padded `6px 10px 1.5px`.
- Nav item: `padding: 7px 10px`, `borderRadius: 7`, `13px`, `font-weight: 400` (active: `500`).
- Active state: `background: #f1f5f9`, `color: var(--color-deep-navy)`. Do NOT invert (no full-navy item with white text — that was the old style).
- Footer: optional org card (`white`, `1px #eef0f3`, `10px` radius, `padding: 12`) + user chip (`28px` initials avatar in `#e2e8f0`, name + role).

### Topbar (inside `DashboardHeader.tsx`)

- Height: `~48px`, `padding: 14px 28px`, white background, bottom border `1px solid #eef0f3`.
- Search input: `1px solid #eef0f3`, `borderRadius: 8`, `padding: 7px 10px`, `13px text-slate-500` placeholder, `⌘K` hint (`10px Geist Mono`-like, monospace stack).
- Icon buttons: `32×32`, `1px #eef0f3` border, `borderRadius: 7`. Bell carries an optional `14×14` red badge (`#dc2626`, white text, 9px).
- Primary CTA (Export report): navy bg, `borderRadius: 7`, `padding: 8px 12px`, `12px font-medium`.

### Page header

- Status pulse: `6×6` green dot (`#16a34a`) with `0 0 0 3px rgba(22,163,74,0.18)` glow + "All systems operational" + "Updated …" mono timestamp.
- Greeting: `28px font-weight: 500 letter-spacing: -0.02em` ("Good morning, {firstName}"), one-sentence subtitle below in `14px text-slate-500`.
- Persona pills: segmented control on `#f8fafc` background with `1px #eef0f3` border, `borderRadius: 9`, `padding: 3`. Active pill: white background with `0 1px 2px rgba(15,23,42,0.06), 0 0 0 1px #eef0f3` shadow + navy text. Inactive: `#64748b` text on transparent.

### KPI cards (`KPICards.tsx`)

- Grid: `2×2` mobile, `1×4` `lg`. Gap `16px`.
- Card: `1px #eef0f3`, `borderRadius: 10`, `padding: 18`, `min-height: 132px`. **No shadow.**
- Layout: label (`12px font-medium text-slate-500`) + delta pill on right; value `28px font-weight: 500 letter-spacing: -0.02em fontVariantNumeric: tabular-nums`; bottom row holds `11px text-slate-400` sub-line and a `90×24` sparkline coloured by delta direction.
- Delta pill: `11px font-medium`, `padding: 2px 6px`, `borderRadius: 4`. Up-good → `#f0fdf4` bg, `#16a34a` fg. Up-bad → `#fef2f2` bg, `#dc2626` fg. Arrow `↑` / `↓`.

### Section cards (`SafeTrend`, `SafeSpfPosture`, `SafeTriage`, `SafeScamTypes`, `SafeLiveActivity`, `SafeEntityTable`)

- White, `1px #eef0f3`, `borderRadius: 12`. **No shadow.**
- Header: `padding: 22px 22px 14px`, flex row with title (`15px font-semibold text-deep-navy tracking-tight`) + subtitle (`12px text-slate-500`) on the left and an optional action link/badge/segmented control on the right.
- Body: `padding: 0 22px 22px` (header eats top padding, body owns bottom).
- Row dividers inside lists: `1px solid #f1f5f9` between rows; last row has no bottom border.

### Numerals & mono

- Tabular numerals everywhere data is shown: `fontVariantNumeric: "tabular-nums"`.
- Mono stack for values, axis ticks, mono meta lines: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Mono sizes: `10–11px` for axis ticks and meta; `13.5px` for inline data values.

### Severity colours (triage, entity risk badges)

| Severity | Background | Foreground | Dot       |
| -------- | ---------- | ---------- | --------- |
| critical | `#FEF2F2`  | `#991B1B`  | `#DC2626` |
| high     | `#FFF7ED`  | `#9A3412`  | `#EA580C` |
| medium   | `#FEFCE8`  | `#854D0E`  | `#CA8A04` |
| low      | `#F0FDF4`  | `#166534`  | `#16A34A` |

Severity badges: `9px font-weight: 600 letter-spacing: 0.05em uppercase`, `padding: 2px 6px`, `borderRadius: 4`. Severity dots: `8×8`, `borderRadius: 999`.

### SPF principle grid

- Six tiles: `Prevent / Detect / Report / Disrupt / Respond / Govern`.
- Tile: `#f8fafc` background, `borderRadius: 7`, `padding: 8px 10px`. Lucide icon (`12px stroke 1.7`) + label + status dot (right-aligned). Below: percentage in mono `14px font-weight: 500`.
- Status dot colours: met `#16a34a`, partial `#f59e0b`, missed `#dc2626`.
- Compliance ring: `96×96`, `r=40`, stroke `8`, navy progress arc on `#f1f5f9` track. Centred percentage label inside the ring (`22px font-weight: 500 letter-spacing: -0.02em`).

### Empty states

Every dashboard list component must render a calm empty state instead of a blank or fake row:

- Pattern: dashed `1px #eef0f3` border on `#fbfbfa`, `borderRadius: 10`, padding `36px 12px`, centered icon-tile + 1-line title (`13px font-medium text-deep-navy`) + 1-line subtitle (`12px text-slate-500`).
- Examples in code: `SafeTriage.tsx` "All clear" green-check tile; `SafeScamTypes.tsx` `No data yet`.

### Files

Source-of-truth components live in `apps/web/components/dashboard/`. The shell pieces (`DashboardSidebar.tsx`, `DashboardHeader.tsx`, `KPICards.tsx`) and the section cards (`SafeTrend.tsx`, `SafeSpfPosture.tsx`, `SafeTriage.tsx`, `SafeScamTypes.tsx`, `SafeLiveActivity.tsx`, `SafeEntityTable.tsx`, plus the shared `Sparkline.tsx`) are the canonical Safe-variant building blocks.

Older inner components (`ChecksChart.tsx`, `ScamTypeBreakdown.tsx`, `ThreatFeed.tsx`, `ComplianceChecklist.tsx`, `EntityFrequency.tsx`, `RecentScans.tsx`, `SourceSplit.tsx`) are still imported by other dashboard sub-pages (`/app/compliance`, `/app/spf-compliance`, etc.) and have not yet been refreshed. New work on those sub-pages should mirror the Safe variant section-card pattern; touching the existing components is fine when the sub-page is being refreshed in scope.

## Animations

### Spinner

```css
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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

| Property      | Value                                |
| ------------- | ------------------------------------ |
| Popup width   | 380px                                |
| Border radius | `rounded-2xl` (larger than web)      |
| Tab control   | Segmented tabs with active highlight |
| Loading       | Spinner animation                    |

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

| Status         | Background            | Text                  | Border                |
| -------------- | --------------------- | --------------------- | --------------------- |
| `queued`       | `#F1F5F9` (slate-100) | `#475569` (slate-600) | `#CBD5E1` (slate-300) |
| `submitted`    | `#DBEAFE` (blue-100)  | `#1D4ED8` (blue-700)  | `#93C5FD` (blue-300)  |
| `acknowledged` | `#FEF3C7` (amber-100) | `#B45309` (amber-700) | `#FCD34D` (amber-300) |
| `actioned`     | `#DCFCE7` (green-100) | `#15803D` (green-700) | `#86EFAC` (green-300) |
| `closed`       | `#F3F4F6` (gray-100)  | `#6B7280` (gray-500)  | `#D1D5DB` (gray-300)  |

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

| Breakpoint | Width  | Usage            |
| ---------- | ------ | ---------------- |
| `sm`       | 640px  | Mobile landscape |
| `md`       | 768px  | Tablet           |
| `lg`       | 1024px | Desktop          |
| `xl`       | 1280px | Wide desktop     |

## Video Embeds

- Responsive 16:9 container
- Full-width within content area
- Rounded corners matching card style

## Accessibility

- All interactive elements must be keyboard-accessible
- Verdict colors chosen for sufficient contrast ratios
- Focus indicators: navy ring on auth + dashboard inputs (set globally in `globals.css` via `input:focus, textarea:focus { box-shadow: 0 0 0 3px rgba(0, 31, 63, 0.1) }`). Marketing forms may still use `ring-2 ring-action-teal` until refreshed.
- Alt text required for all images
- Semantic HTML (headings hierarchy, landmark regions)
