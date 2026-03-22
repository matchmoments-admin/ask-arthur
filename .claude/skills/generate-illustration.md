# generate-illustration

Generate web illustrations using the Gemini MCP image generation tool.

## Usage

```
/generate-illustration <subject> [--style <style>] [--palette <palette>] [--size <WxH>] [--output <path>]
```

## Instructions

When this skill is invoked, follow these steps:

### 1. Parse the input

Extract from the user's arguments:
- **Subject/prompt**: What the illustration should depict (required)
- **Style**: One of the styles below, or a custom style description (default: `textured-flat`)
- **Palette**: Either a preset name or comma-separated hex colors (default: `ask-arthur`)
- **Size**: Dimensions like `800x600` (default: `1024x1024`)
- **Output path**: Where to save the file (default: `apps/web/public/illustrations/`)

### 2. Build the generation prompt

Construct a detailed prompt by combining the subject with the style template and palette. Use this structure:

```
Create a [STYLE_DESCRIPTION] illustration.

SUBJECT: [USER_SUBJECT]

COLOR PALETTE (use ONLY these colors, plus white):
[PALETTE_COLORS]

COMPOSITION: Generous negative space. Centered composition. Clean and uncluttered. No text in the image.
ASPECT RATIO: [DERIVED_FROM_SIZE]
```

### 3. Generate with Gemini MCP

Use the `mcp__gemini__generate_image` tool (or equivalent Gemini image generation tool) to generate the illustration. If that specific tool isn't available, check available Gemini MCP tools with ToolSearch for image/generate related tools.

### 4. Save the output

Save the generated image to the specified output path. If the filename isn't specified, derive one from the subject (e.g., `category-phone-scam.png`).

### 5. Report back

Tell the user:
- Where the file was saved
- The exact prompt used (so they can iterate)
- Suggest viewing it with their file manager or browser

---

## Style Presets

### textured-flat (default)
Textured flat editorial illustration with a neo-retro, mid-century modern feel. Digital vector-style with risograph grain overlay. Bold simplified geometric shapes. No realistic detail. Figures composed of rounded rectangles, circles, and simple curves. Minimal facial features (dots for eyes, simple curves). No outlines or very minimal outlines. Visible fine grain/noise texture across all colors like risograph printing.

### flat
Simple flat vector illustration. Geometric shapes, solid bold colors, no shadows, no gradients, clean edges, minimal detail, SVG style.

### isometric
Isometric vector illustration in 30-degree axonometric projection. Geometric precision, clean lines, bright colors, no perspective distortion.

### line-art
Clean line art illustration, outline only, no fill, single stroke weight, minimalist line drawing, elegant continuous lines.

### hand-drawn
Hand-drawn sketch style illustration. Visible pencil strokes, imperfect organic lines, cross-hatching shading, natural irregularity.

### geometric
Geometric abstract illustration. Precise mathematical shapes, bold color blocking, pattern-driven composition, circles triangles polygons, modernist design.

### 3d-rendered
3D rendered illustration with smooth stylized surfaces, soft shadows, depth of field, matte plastic material, studio lighting.

### paper-cut
Paper cut layered illustration with visible paper layers, subtle drop shadows between layers, cut-edge aesthetic, paper texture, tactile craft style.

### watercolor
Digital watercolor illustration. Soft color washes, visible brush strokes, wet-on-wet blending, organic color bleeding, delicate airy aesthetic.

### minimalist
Minimalist icon-style illustration. Maximum simplicity, essential elements only, generous negative space, reduced geometric forms.

### retro
Retro vintage illustration with mid-century aesthetic, worn paper texture, screen-print style, nostalgic muted color palette, 1960s poster art style.

### gradient-mesh
Gradient mesh illustration with complex multi-point color gradients, smooth organic forms, rich saturated luminous colors, flowing shapes.

### claymation
Claymation style 3D illustration. Soft clay material, rounded playful forms, warm pastel colors, soft studio lighting, handmade clay figurine look.

### duotone
Duotone illustration using two colors only. High contrast, graphic poster style, simplified tonal range, bold dramatic effect.

### collage
Mixed media collage illustration combining photography cutouts with drawn elements, torn paper edges, varied textures, editorial style.

### pixel-art
Pixel art illustration with visible square pixels, limited color palette, dithering patterns, 8-bit retro game aesthetic, sharp pixelated edges.

### stipple
Stipple pointillism illustration composed entirely of dots, density variation for tonal depth, scientific illustration style.

### art-deco
Art deco style illustration with geometric symmetrical patterns, sunburst fan motifs, gold and jewel tone colors, 1920s glamour aesthetic.

### bauhaus
Bauhaus style illustration with primary colors, strict geometric forms (circle, triangle, square), functional modernist aesthetic, bold stark contrasts.

### scandinavian
Scandinavian Nordic minimal illustration. Muted earthy palette, organic simple shapes, nature motifs, generous whitespace, folk art influence.

### editorial
Editorial newspaper illustration. Conceptual metaphorical imagery, bold dramatic composition, strong visual storytelling, symbolic imagery.

### neubrutalist
Neubrutalist illustration with thick black outlines, loud clashing bright colors, raw unpolished aesthetic, chunky offset drop shadows, sharp corners.

### blob
Organic blob shape illustration with amorphous rounded forms, soft undulating edges, gradient-filled blobs, calming pastel palette, friendly aesthetic.

### low-poly
Low-poly illustration with faceted triangular mesh, flat-shaded polygons, crystalline geometric appearance, gem-like quality.

### surrealist
Surrealist dreamlike illustration with impossible perspectives, floating objects, unexpected scale, ethereal lighting, dream logic composition.

### woodblock
Woodblock linocut illustration with bold carved lines, high contrast, visible cut marks, printmaking aesthetic, strong graphic impact.

### grain-gradient
Grain noise gradient illustration with smooth color gradients and heavy dithered noise overlay, aurora-like color bands, ethereal glow.

### outline-spot
Outline illustration with spot color. Black line drawing with selective flat color fills, limited 2-color accent palette, editorial sophistication.

---

## Palette Presets

### ask-arthur (default)
The Ask Arthur brand palette — navy-forward with slate blue accent and gold for alerts.
- Deep Navy: #001F3F
- Navy: #002B45
- Muted Slate Blue: #6B8EA4
- Soft Wash: #D6E4ED
- Cool Cream: #EFF4F8
- Slate: #64748B
- Pale Slate: #94A3B8
- Harvest Gold: #E8B64A

### earthy
Warm earthy tones from the Lummi illustration style.
- Harvest Gold: #E8B64A
- Dusty Sage: #8BA888
- Terracotta Coral: #D4836D
- Muted Slate Blue: #6B8EA4
- Warm Cream: #F5F0E8
- Charcoal Ink: #2D3436
- Desert Tan: #C19A6B
- Forest Muted: #4A6741

### ocean
Cool blue tones.
- Deep Ocean: #0B1D3A
- Marine Blue: #1E3A5F
- Sky Blue: #5B9BD5
- Seafoam: #A8D8EA
- Ice: #E8F4FD
- Cloud: #F5F9FC
- Coral Accent: #FF6B6B
- Sand: #F4E4C1

### sunset
Warm gradient palette.
- Deep Purple: #2D1B69
- Plum: #7B2D8E
- Magenta: #E91E8C
- Coral: #FF6B6B
- Peach: #FFB088
- Gold: #FFD93D
- Cream: #FFF8E7
- Dusk: #4A3F6B

### forest
Natural green-focused palette.
- Deep Forest: #1B3A2D
- Pine: #2D5F3E
- Sage: #7D9B7A
- Moss: #A8C69F
- Lichen: #D4E4CF
- Mist: #EDF3EB
- Bark: #6B4F3A
- Amber: #D4A843

### monochrome
Grayscale with single accent.
- Black: #1A1A1A
- Dark: #333333
- Mid: #666666
- Gray: #999999
- Light: #CCCCCC
- Pale: #E5E5E5
- Near White: #F5F5F5
- Accent Blue: #3B82F6

### pastel
Soft pastel tones.
- Blush: #FFB5B5
- Lavender: #C4B5FD
- Mint: #A7F3D0
- Sky: #BAE6FD
- Butter: #FDE68A
- Peach: #FDBA74
- Lilac: #DDD6FE
- Cloud: #F8FAFC

### bold
High contrast vibrant palette.
- Electric Blue: #0066FF
- Hot Pink: #FF0066
- Lime: #00FF66
- Yellow: #FFCC00
- Purple: #6600FF
- Orange: #FF6600
- Black: #111111
- White: #FAFAFA

---

## Examples

```
/generate-illustration "a smartphone with warning chat bubbles floating above it, a shadowy hand reaching toward the phone"
```

```
/generate-illustration "a fish hook piercing through an email envelope on a laptop screen" --style textured-flat --palette earthy
```

```
/generate-illustration "an open gift box that is empty inside except for a mousetrap, confetti floating above" --style claymation --palette pastel --size 800x600 --output apps/web/public/illustrations/category-lottery-prize.png
```

```
/generate-illustration "hero banner showing Australian suburban street from above with protective shields over houses" --style textured-flat --palette ask-arthur --size 1344x768 --output apps/web/public/illustrations/hero-homepage.png
```
