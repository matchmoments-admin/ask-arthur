---
name: generate-illustration
description: Generate faceless flat-vector illustrations for Ask Arthur using Gemini MCP
---

# generate-illustration

Generate illustrations for Ask Arthur using the Gemini MCP. Outputs WebP to `apps/web/public/illustrations/`.

## Usage

```
/generate-illustration <subject> [--style <style>] [--palette <palette>] [--aspect <ratio>] [--output <filename>]
```

## Instructions

### 1. Parse input

- **Subject**: What to illustrate (required)
- **Style**: `flat-faceless` (default), `textured-flat`, `scene` — see presets below
- **Palette**: `ask-arthur` (default) — navy/slate-blue/gold
- **Aspect**: `4:3` (feed cards, blog heroes), `1:1` (callouts, icons)
- **Output**: filename without extension (auto-adds `.webp`)

### 2. Character rules (CRITICAL)

ALL characters MUST be:
- **FACELESS** — NO eyes, NO mouth, NO nose. Blank smooth face.
- Only dark hair silhouette shape on head
- Natural elegant proportions, slightly elongated
- Like Freepik/Storyset faceless style
- One character at a time

### 3. Composition rules

- Clean `#EFF4F8` background
- NO plants, NO leaves, NO decorative foliage
- Centered composition, generous negative space
- NO text in the image

### 4. Build the prompt

```
[SUBJECT]. Character has NO facial features — completely blank smooth face with only dark hair silhouette. [STYLE]. Clean cream background (#EFF4F8). No plants, no leaves. No text.

CHARACTER STYLE: Faceless flat vector — NO eyes, NO mouth, NO nose. Blank smooth skin (#D6E4ED) with dark hair shape. Like Freepik faceless style.

COLOR PALETTE (strict): Deep navy (#001F3F) for hair, muted slate blue (#6B8EA4) for clothing, darker navy (#002B45) for pants, soft blue-gray (#D6E4ED) for skin, warm harvest gold (#E8B64A) for accents, cool cream background (#EFF4F8).
```

### 5. Generate

Call `mcp__gemini__gemini-generate-image` with the prompt, style, aspectRatio, imageSize: "2K".

### 6. Post-process

1. Rename from timestamp: `mv image-*.jpeg <output>.jpg`
2. Convert to WebP: `node -e "require('sharp')('<output>.jpg').webp({quality:80}).toFile('<output>.webp')"`
3. Remove JPG: `rm <output>.jpg`
4. Report file path and size

### 7. Update references

If replacing an existing illustration, update references in:
- `apps/web/lib/feed.ts` (category illustrations)
- Database `blog_posts.hero_image_url` (blog heroes)
- Any component importing the path

---

## Style Presets

### flat-faceless (default — for characters)
Modern flat vector, faceless characters, clean minimal, smooth shapes, elegant poses, generous white space.

### textured-flat (for scene illustrations — feed cards)
Textured flat editorial with risograph grain. Bold geometric shapes, no outlines. Centered, clean background.

### scene (for conceptual illustrations — no characters)
Object-focused scene illustration. Bold shapes, navy/slate/gold palette, clean composition.

---

## Ask Arthur Palette

| Role | Hex |
|------|-----|
| Hair, shoes, dark elements | `#001F3F` |
| Clothing top, info elements | `#6B8EA4` |
| Pants, secondary dark | `#002B45` |
| Skin tone | `#D6E4ED` |
| Background | `#EFF4F8` |
| Accent (warnings, highlights) | `#E8B64A` |
| Text slate | `#64748B` |

---

## Existing Character Variants

| File | Character |
|------|-----------|
| `blog-product.webp` | Man at laptop with shield (side profile) |
| `char-man-lightbulb.webp` | Same man at laptop with lightbulb |
| `char-young-woman.webp` | Young woman, long dark hair, hand on hip |
| `char-older-man.webp` | Older man, white hair, glasses, arms crossed |
| `char-older-woman.webp` | Older woman, white bob, cardigan, welcoming |

---

## Examples

```
/generate-illustration "person holding warning shield" --aspect 1:1 --output callout-danger
```

```
/generate-illustration "shopping cart floating over cracked ground with price tag" --style textured-flat --aspect 4:3 --output category-shopping-scam
```
