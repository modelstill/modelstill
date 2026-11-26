# @modelstill/ui

The shared UI library for ModelStill products: shadcn/ui components (new-york style, Radix, Tailwind
v4), our design tokens, and small composable blocks for dense developer-tool dashboards. Every block
and state is rendered at `/ui` in `apps/website`.

**The design is one system.** The tokens in `globals.css`, the shadcn customisations and the
dashboard shell are documented below. Change a rule here and in the code together, or record why
they differ.

## Layout

```
packages/ui
  components.json           shadcn config for this package (aliases point at @modelstill/ui/*, icons: phosphor)
  src/styles/globals.css    tokens (light :root, dark .dark), @theme inline mapping, base layer
  src/components/           shadcn components, added with the CLI, with the customisations
  src/blocks/               our own composable blocks
  src/lib/                  cn, interval formatting
  src/hooks/                use-mobile (from shadcn sidebar)
  src/vendor/helicone/      Apache-2.0 files adapted from Helicone, with LICENSE (see /NOTICE)
  test/                     bun test + happy-dom + Testing Library
```

## Using it in an app

1. Add `"@modelstill/ui": "workspace:*"` to the app and `transpilePackages: ["@modelstill/ui"]` to `next.config`.
2. Import the CSS once in the root layout: `import "@modelstill/ui/globals.css"`.
3. Load the fonts with `next/font/google` and put their variables on `<html>`: DM Sans as
   `--font-dm-sans` and JetBrains Mono as `--font-jetbrains-mono` (see `apps/website/src/app/layout.tsx`).
4. Give the app a `components.json` whose `ui` and `utils` aliases point at `@modelstill/ui/components`
   and `@modelstill/ui/lib/utils`, whose `tailwind.css` is `../../packages/ui/src/styles/globals.css`,
   and whose `iconLibrary` is `phosphor`.
5. Wrap the app in `LinkProvider` (from `blocks/link`) with your router's link so blocks render real links.

Add or update components from the app or this package with the CLI, never by hand:

```
bunx --bun shadcn@latest docs <component>
bunx --bun shadcn@latest add <component> -c packages/ui
```

After adding, strip the `//` and `/* */` comments the registry ships (AGENTS.md forbids them in TS),
and re-apply the customisations listed under Components below.

## Icons

Phosphor only (`@phosphor-icons/react`, MIT, pinned), regular weight.
Import the `*Icon` names (`MagnifyingGlassIcon`, not the deprecated `MagnifyingGlass`). Pass icons as
components, mark icons inside a `Button` with `data-icon="inline-start|inline-end"`, and never put a size
class on an icon inside a component: the component sizes it (16px in dense UI, 18px in the top bar).
lucide-react is not a dependency.

## Primitives

Take values from here. A value missing from this table is a question, not a decision for the screen.

| Name | Light | Dark | Token |
|---|---|---|---|
| Accent purple | `#8b47eb` | `hsl(264 83% 66%)` | `--primary`, `--brand`, `--ring`, `--chart-1` |
| Purple text on wash | `#7a35e0` | `#c4a5fa` | `--brand-text` |
| Purple wash | `rgb(139 71 235 / 0.1)` | `rgb(166 117 245 / 0.16)` | `--brand-wash` |
| Lavender frame | `rgb(248 246 254)` | `hsl(240 10% 6%)` | `--sidebar` |
| Page | white | `hsl(240 10% 7%)` | `--background` |
| Card | white | `hsl(240 8% 10%)` | `--card` |
| Ink | `#333333` | `hsl(250 20% 96%)` | `--foreground` |
| Muted ink | `#6b6b6b` | `hsl(240 8% 64%)` | `--muted-foreground` |
| Quiet surface | `hsl(252 33% 96.5%)` | `hsl(240 7% 15%)` | `--muted`, `--secondary`, `--accent` |
| Line | `hsl(250 24% 92%)` | `hsl(240 7% 18%)` | `--border` |
| Field line | `hsl(250 24% 90%)` | `hsl(240 7% 20%)` | `--input` |
| Grid line | `hsl(250 24% 94%)` | `hsl(240 7% 16%)` | `--grid` (chart gridlines) |
| Danger | `hsl(0 75% 55%)` | `hsl(0 70% 60%)` | `--destructive` |

Status pairs (text on tint), used by `Badge` variants: ok `#127a36` on `#e7f6ec` (`success`), run
`#1d4ed8` on `#e8effd` (`info`), warn `#a3500a` on `#fdf1df` (`warning`), fail `#c81e1e` on `#fdecec`
(`danger`), idle `#6b6b6b` on the quiet surface (`secondary`). Dark uses the same hue lifted, on a 12% tint.

Type: **DM Sans** for everything, JetBrains Mono for ids, hashes, model names and JSON. Body 14px.
Sizes 12, 13, 14, 16, 18, 22, 24px (`text-xs` 12, `text-sm` 13, `text-base` 14, `text-lg` 16); 13.5px
only in the frame (nav rows, card titles, breadcrumb-adjacent labels). Weights 400 and
500 only. Numbers are `tabular-nums` (tables, stat cards and intervals set it).

Radius: `rounded-sm` 6px (small buttons, menu items), `rounded-md` 10px (controls, nav rows),
`rounded-lg` 12px (cards, tables, menus, dialogs: `--radius-panel`), `rounded-xl` 14px only for the
content frame. `--radius-tile` 4px for checkboxes and tiles.

Controls: 32px (`--btn-h`, `--input-h`), 28px for `size="sm"` in toolbars.

Elevation: the dashboard is flat. `shadow-panel` (`0 1px 2px rgba(16,16,24,.04)`) on buttons and the
active nav row, `shadow-menu` on menus, dialogs and sheets. Nothing else floats.

Spacing: Tailwind's 4px scale. Page padding 20px, 32px from `sm`. Tables 16px cell padding.

## Semantic tokens

The base tokens in `globals.css`:
lavender frame, white content card, #333 ink, purple #8b47eb accent, hairline lavender borders, flat
surfaces, DM Sans.

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `surface-page`, `surface-frame`, `surface-head`, `surface-hover`, `surface-selected`, `surface-focus` | Behind content, the frame, sticky heads, row under the pointer, a checked row, the keyboard's row |
| Lines | `line-cell`, `line-strong` | Hairlines between cells, edges of a grid |
| Status | `status-ok`, `-run`, `-warn`, `-fail`, `-idle` (each with `-bg`) | Status only, never decoration |
| Marks | `mark` | Neutral fill of a bar that is not a status |
| Charts | `chart-1` purple (the series that matters), `chart-compare` (the comparison, lighter purple, dashed when a line), `chart-2..5` green, blue, amber, cyan | No vertical gridlines, no axis lines, 12px ticks, 4px bar radius, 1.5px lines |
| Density | `grid-row-h` 36, `grid-head-h` 34, `grid-toolbar-h` 40, `grid-cell-px` 10, `grid-text` 13 | Dense grids |
| Motion | `motion-fast` 120ms, `motion-base` 200ms, `motion-ease` | Hover and panels. `.ms-spin` is the one progress spinner; nothing pulses or blinks |

## Components

The shadcn components keep their API. What differs from stock:

| Part | Change |
|---|---|
| Button | 32px default, 28px `sm`, `size="icon"` 32px; one-pixel purple focus ring; `default` and `outline` carry `shadow-panel` |
| Badge | 20px high, 5px radius, status pairs for `success`, `warning`, `danger`, `info`, `secondary`; `outline` is a ring on white |
| Card | 12px radius, hairline border, no shadow, 20px padding; `CardTitle` is a 13px muted label |
| Table | Head 36px, 13px regular muted; rows 40px, 16px padding, `text-foreground/85`, `tabular-nums`; selected rows use `surface-selected` |
| Tooltip | Purple pill (`bg-primary`) with a 6px radius |
| Input, Select, Textarea | 32px, white fill, no shadow, one-pixel purple focus ring |
| DropdownMenu, Select, HoverCard, Dialog, Sheet | 12px radius and the menu shadow; menu items 32px |
| Sidebar | 232px wide, 56px folded to icons; nav rows 32px, 13.5px, muted icon, active row is a white pill with `shadow-panel`; the inset content card has a 14px radius and a hairline |

## Blocks

| Block | Use it for |
|---|---|
| `AppShell` | The frame: lavender sidebar, white content card 8px from the window, a 48px top bar with the fold button, a breadcrumb slot (put the section icon first) and actions. |
| `BrandLockup`, `BrandMark` | The "M" mark and the ModelStill wordmark at the head of the sidebar (56px row). |
| `WorkspaceSwitcher` | A workspace switcher, used for tasks: 32px trigger with an initial tile, a menu with search, items with a meta slot, a check on the active one, and actions under a separator. |
| `UserMenu` | The account row in the sidebar foot: avatar, name, a detail line, and a menu that opens upward. |
| `PageHeader`, `BreadcrumbTrail` | 18px medium title, 13.5px muted description, meta line and actions. Breadcrumbs use a `/` separator, the last crumb medium. |
| `Section`, `PageBody` | A labelled region with a 13.5px muted heading; the page container with standard padding. |
| `Toolbar`, `ToolbarText`, `ToolbarSpacer` | A row of filters and actions above a table or chart. |
| `DataTable` | Any list of records: a card with a slim bar above the rows, plain sticky header cells, a footer on the frame tint. TanStack sorting, column visibility, row selection, `onRowClick`, a `detail` side `Sheet`, `maxHeight`, `compact` (36px) or `default` (40px) rows. |
| `StatCard` | Muted 13px label, 22px medium figure, optional interval and trend, a 12px note. |
| `ChartCard` | Muted 13.5px title, optional 24px value and note, then the chart. |
| `KeyValueList` | Settings and record detail; `rows` for sheets, `grid` for a card of facts. |
| `JsonView` | Inputs, outputs and payloads (collapsible, copyable). |
| `CodeId` | Hashes and ids: truncated monospace with the full value as title and a copy button. |
| `LoadingState`, `ErrorState`, `EmptyState` | The three non-data states of every view. |
| `IntervalValue`, `IntervalBar` | A mean with `[low, high]` and a tiny bar; `signed` marks zero, `compare` draws a reference tick. |
| `VerdictBadge`, `PassBadge`, `ModeBadge` | better / worse / no detectable difference; gate pass/fail; off / shadow / serve. |
| `GateChecks` | A gate's checks with threshold, measured value and result. |
| `ComparisonSummary` | Paired difference with interval, verdict, fixed and broken counts. |
| `TeacherDiff` | Teacher outputs side by side, field by field, with disagreements highlighted. |
| `RequestsChart`, `DeferralChart`, `LatencyChart` | Gateway traffic charts on shadcn `chart`, with the chart conventions above. |
| `CommandPalette` | ⌘K jump list built on `Command` in a dialog; `trigger` renders the sidebar's Search row with the shortcut. |
| `ThemeToggle`, `LinkProvider` | Light/dark switch (next-themes); router-agnostic links for blocks. |

## Rules

One sentence each, with the reason.

- Icons are Phosphor, regular weight, because one icon family is what makes the dashboard read as one product.
- Take every value from the primitives or semantic tokens above, never invent one, because a one-off value is how two screens drift apart.
- Purple is the accent: the primary action, focus rings, selection, the brand mark and the series that matters in a chart, because a page with purple everywhere has no accent.
- Status colours mean status only, never decoration, because colour that means two things means nothing.
- Status is visible at a glance as a badge or a dot and words, because an operator scans for what is running, passed or failed before reading anything.
- One primary button per screen, because the screen must say what the next step is.
- Numbers in tables are `tabular-nums` and right-aligned when they are counts or scores, because columns of numbers must line up to be compared.
- Every estimate is shown with its interval (`IntervalValue`, or `StatCard` with `interval`), because a score without one cannot be trusted (AGENTS.md).
- Every block has a loading state in its own shape (`LoadingState`, skeletons), an empty state that says what to do (`EmptyState`), and an error state with a retry (`ErrorState`), because a blank area reads as broken.
- Progress never blinks: a steady label with a slowly turning `.ms-spin` icon, and reduced motion stops it, because blinking reads as an error.
- Text on screen states only what is true now, from the data, because a status that guesses is worse than none.
- Copy has no em dash and no semicolon, because the voice is short plain sentences.
- Use `rounded-lg` for cards, tables and menus, and `rounded-xl` only for the content frame, because two radii for the same kind of surface make two products.
- New screens use white surfaces, hairline borders and quiet type with no gradients or art tiles, because they are working screens.
- Semantic colour classes only (`bg-primary`, `text-muted-foreground`, `text-status-ok`), no raw palette classes and no `dark:` overrides in app code, because the tokens already carry both themes.
- `flex`/`grid` with `gap-*`, never `space-x/y-*`; `size-*` for squares; full Card composition; forms use `Field`; 2 to 7 options use `ToggleGroup`.
- No `//` or `/* */` comments outside `src/vendor/`.
- Check a screen in a real browser at 1440 and 390, light and dark, because a screen that only passed tests has not been seen.

## Reviewing a screen

Check each screen against this list:

1. Values are tokens: `rg -n "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|shadow-\[" <files>` finds nothing outside `globals.css`; arbitrary sizes are only the listed ones.
2. Every block has its loading, empty and error states, with no layout jump when data lands.
3. Status text and counts match the API response for the same moment.
4. Copy and rules above: no em dash, no semicolon, one primary button, Phosphor icons, purple only as the accent.
5. In a real browser at 1440 x 900 and 390 x 844, light and dark: no horizontal page scroll at 390, nothing cut off, focus visible, tables scroll inside themselves.

## Tests

`bun run test` in this package. Each block has a behaviour test in `test/`.
