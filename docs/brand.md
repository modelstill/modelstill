# ModelStill brand

## Concept

ModelStill distils a cloud model into a still, small model you own.

"Still" carries two meanings and the brand leans on both:

- **A distillation still.** Something large and diffuse goes in, something small and concentrated
  comes out. A frontier model's behaviour on one task is condensed into a model that fits on your
  own hardware.
- **Still as in calm.** The small model is steady: versioned, gated, monitored, and it does not
  change under you when a provider ships a new release.

The mark draws exactly that: a wide bar (the cloud model), a narrower bar (the task-shaped
behaviour), and a single drop (the small model you keep). The horizontal bars also read as still
water. The mark is original geometry; it is not derived from any other brand.

## The mark

Built on a 32 x 32 grid.

| Part | Geometry |
|---|---|
| Tile | 32 x 32 rounded square, corner radius 8 |
| Wide bar | x 6, y 7, 20 x 4, radius 2 |
| Narrow bar | x 10, y 14, 12 x 4, radius 2 |
| Drop | circle, centre (16, 23.5), radius 3.5 |

Every stroke is 4 units thick (the drop is 7 units across), so at 16 px each bar is 2 px tall and
stays crisp; the favicon was checked at 16, 32 and 48 px.

- **Clear space:** keep at least 8 units (a quarter of the tile) free on every side.
- **Minimum size:** 16 px for the mark, 96 px wide for the lockup.
- **Lockup:** mark, a 10-unit gap, then the wordmark "ModelStill" in DM Sans Bold (700),
  letter-spacing -0.015em, its cap height centred on the tile. In the SVG files the wordmark is
  converted to outlines, so it renders the same without the font.

## Colour

ModelStill pairs a neutral grey scale with a petrol cyan accent (changed from teal on
24 Nov 2026).

Why petrol cyan:
- **Free in the space:** no evaluation, LLM-ops or model-hosting brand we checked uses teal or cyan
  as its main colour. Blue, orange, purple and yellow are crowded.
- **Clear of pass and fail:** teal sat about 33 degrees of hue from the success green, with a
  CIEDE2000 distance of 17.6, so brand chips competed with "pass" badges. Petrol cyan is 34.7 from
  success and 56.8 from danger, and stays above 35 under simulated deuteranopia and protanopia
  (Machado 2009).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | `#0e7490` | `#22d3ee` | Mark tile, primary buttons, focus ring, charts series 1 |
| `--brand-foreground` | `#ffffff` | `#083344` | Glyph on the tile, text on primary buttons |
| `--brand-text` | `#155e75` | `#67e8f9` | Brand-coloured text on `--brand-wash` |
| `--brand-wash` | `rgb(14 116 144 / 0.1)` | `rgb(34 211 238 / 0.16)` | Tinted chips and highlights |
| `--chart-5` | `hsl(262 60% 58%)` | `hsl(262 60% 66%)` | Moved off cyan so it never duplicates series 1 |
| Wordmark ink | `#1f1d2b` | `#f4f3fa` | Wordmark in the static logo files |

Status colours are never the brand colour, and a status badge always carries an icon and a text
label. Pass and fail stay close for colour-blind readers in every palette: success against danger is
only 6.9 under simulated deuteranopia in dark mode, so colour alone must never carry the meaning.

Neutrals: foreground `#333333`, muted text `#6b6b6b`, frame `#f8f6fe`
(light) and `hsl(240 10% 7%)` = `#101013` (dark).

### Contrast (WCAG 2.x)

Computed with the WCAG relative-luminance formula; washes are blended over their background first.

| Pair | Ratio | Passes |
|---|---|---|
| `#0e7490` on `#ffffff` (brand text and links on white) | 5.36:1 | AA normal text |
| `#ffffff` on `#0e7490` (button label on brand) | 5.36:1 | AA normal text |
| `#0e7490` on `#f8f6fe` (brand on the frame) | 5.00:1 | AA normal text |
| `#22d3ee` on `#101013` (dark brand on dark page) | 10.51:1 | AAA |
| `#083344` on `#22d3ee` (dark button label) | 7.41:1 | AAA |
| `#155e75` on light wash (`#e7f1f4`) | 6.33:1 | AA normal text |
| `#0e7490` on light wash (`#e7f1f4`) | 4.67:1 | AA normal text |
| `#67e8f9` on dark wash (`#132f36`) | 9.74:1 | AAA |
| `#333333` on `#ffffff` (foreground) | 12.63:1 | AAA |
| `#6b6b6b` on `#ffffff` (muted text) | 5.33:1 | AA normal text |
| `#1f1d2b` on `#ffffff` (wordmark ink) | 16.55:1 | AAA |
| `#f4f3fa` on `#101013` (dark wordmark ink) | 17.23:1 | AAA |

### Theme

Light is the default theme (decided 24 Nov 2026). The dashboard is forced to light: it does not
follow the operating system, so a user whose OS is in dark mode still gets
the light UI, and the theme toggle is hidden from the top bar and the command palette. The dark
tokens stay in `globals.css`. Switching comes back by setting `THEME_SWITCHING_ENABLED` in
`apps/website/src/lib/theme.ts`.

The sign-in, sign-up and onboarding scene is bright: a large headline in dark text on the frame
colour `#f8f6fe`, a rounded panel with a light petrol gradient, and white cards with a border and
petrol accents floating on it. Scene cards are illustrations, not data: each carries an "Example"
tag, shows no scores, prices or results, and the gate is shown as checking, never as passed.

| Scene pair | Ratio | Passes |
|---|---|---|
| `#333333` on `#f8f6fe` (scene headline) | 11.83:1 | AAA |
| `#333333` on `#ffffff` (card text) | 12.63:1 | AAA |
| `#6b6b6b` on `#ffffff` (card labels) | 5.33:1 | AA normal text |
| `#6b6b6b` on `#f8f6fe` (caption over the frame) | 4.98:1 | AA normal text |
| `#155e75` on `#ffffff` (terminal output, chips) | 7.26:1 | AAA |
| `#0e7490` on `#ffffff` (caption link) | 5.36:1 | AA normal text |

### Motion

Motion is subtle and fast: 150-250 ms for UI transitions, never blocking, and off under
`prefers-reduced-motion`. Toasts and badges keep their static colours and only scale in. See
[ADR 0015](decisions/0015-animation-libraries.md).

## Typography

- **DM Sans** for the interface and the wordmark (loaded with `next/font/google` in
  `apps/website/src/app/layout.tsx` as `--font-dm-sans`). Wordmark: weight 700, tracking -0.015em.
- **JetBrains Mono** for code, keys, slugs and numbers that line up (`--font-jetbrains-mono`).

## Usage

Do:

- Use `mark.svg` / `logo.svg` on light backgrounds and `mark-dark.svg` / `logo-dark.svg` on dark.
- Use the mono files when only one colour is available (print, embossing, partner pages).
- In the app, use `<LogoMark/>`, `<Logo/>` or `<BrandLockup/>` from
  `@modelstill/ui/blocks/brand`; they read `--brand` and `--brand-foreground`, so they follow
  light and dark mode.
- Keep the clear space and the minimum sizes.

Don't:

- Recolour the tile outside the brand tokens, add gradients, shadows or outlines.
- Stretch, rotate, or rearrange the bars and the drop.
- Set the wordmark in another typeface or change its tracking.
- Place the mark on a busy photo or a colour that drops it below 3:1 against its background.
- Combine the mark with any third-party logo into one lockup.

## Files

| File | What |
|---|---|
| `apps/website/public/brand/mark.svg` | Mark, petrol cyan tile with white glyph |
| `apps/website/public/brand/mark-dark.svg` | Mark for dark backgrounds |
| `apps/website/public/brand/mark-mono.svg` | One-colour mark, black, glyph knocked out |
| `apps/website/public/brand/mark-mono-white.svg` | One-colour mark, white, glyph knocked out |
| `apps/website/public/brand/logo.svg` | Lockup for light backgrounds |
| `apps/website/public/brand/logo-dark.svg` | Lockup for dark backgrounds |
| `apps/website/public/brand/logo-mono.svg` | One-colour lockup, black |
| `apps/website/public/brand/logo-mono-white.svg` | One-colour lockup, white |
| `apps/website/public/brand/icon-192.png`, `icon-512.png` | App icons for manifests |
| `apps/website/src/app/icon.svg` | SVG favicon, switches colours with `prefers-color-scheme` |
| `apps/website/src/app/favicon.ico` | 16, 32 and 48 px favicon |
| `apps/website/src/app/apple-icon.png` | 180 px Apple touch icon |
| `apps/website/src/app/opengraph-image.png` | 1200 x 630 social card |
| `packages/ui/src/blocks/brand.tsx` | `LogoMark`, `Logo`, `BrandLockup`, `PRODUCT_NAME` |

## Third-party logos

Model-provider logos (DeepSeek, Qwen, OpenAI, Anthropic, Google, Mistral AI, Meta, Microsoft,
NVIDIA, Cohere, xAI, IBM, Moonshot AI, Zhipu AI) come from
[theSVG](https://github.com/glincker/thesvg) through the npm package `@thesvg/react`, pinned at
`4.0.14` in `packages/ui/package.json` and wrapped by `packages/ui/src/blocks/provider-icon.tsx`.

- **Licence:** theSVG's code and packages are MIT licensed.
- **Trademarks:** per theSVG's `TRADEMARK.md` and `LEGAL.md`, every logo stays the property of
  its owner, theSVG is not affiliated with or endorsed by those brands, grants no trademark rights,
  and provides the icons for identification only under nominative fair use. Users must follow each
  brand's own usage guidelines. Some icons carry a per-icon licence of "Fair Use" or "Proprietary",
  which means identification only.
- **How ModelStill uses them:** nominatively only, as a small icon next to a model name in the
  dashboard so people can tell which provider a model comes from. They never appear in
  ModelStill's own logo, marketing lockups, favicon or social card, and never imply endorsement.
  Unknown models get a neutral letter tile instead of a guessed logo.
- Icons that ship with internal gradient ids (Google's multi-colour Gemini, Meta's colour mark) are
  replaced by single-colour variants so several icons on one page cannot clash.
