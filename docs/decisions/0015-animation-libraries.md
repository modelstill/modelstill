# 0015. Animate with Motion and our own motion components

- **Status:** accepted
- **Date:** 2026-11-24, revised 2026-11-26
- **Deciders:** dashboard maintainers

## Context

The dashboard had almost no motion. shadcn's `animate-in`,
`fade-in` and `zoom-in` classes were on dialogs, menus, sheets and tooltips, but `tw-animate-css`
was never imported, so none of them ran. The goal is subtle, fast animation (150-250 ms, never
blocking) built on shadcn/ui and Motion.

Licences, checked 24 Nov 2026:

- **shadcn/ui** and **tw-animate-css**: MIT.
- **Motion** (`motion` on npm, motion.dev): MIT. Motion+ is a paid product and is not used.

The first version of this decision used a third-party animated component registry under the
dashboard app. Its licence was MIT with a condition that forbids selling the software or a product
whose value comes mainly from it. The repository is going public under Apache-2.0 and backs a
commercial product, so on 26 Nov 2026 that code was removed and replaced with our own components
(see the last addendum).

## Decision

1. `motion` (14.14.0) and `tw-animate-css` (1.4.0) are pinned exactly and may be used anywhere,
   including `packages/ui`.
2. The dashboard's animated components are our own, written on Motion, in
   `apps/website/src/components/motion/`. No third-party component code with a licence other than
   one compatible with Apache-2.0 is added.
3. Every animation respects `prefers-reduced-motion`:
   - Motion components sit under `MotionConfig reducedMotion="user"`
     (`apps/website/src/components/motion/motion-provider.tsx`).
   - Each of our motion components also reads `useReducedMotion`: enter effects render in their
     final state, indicators move without a spring, counters jump to the final value, and the
     code-input shake is skipped.
   - A global rule in `packages/ui/src/styles/globals.css` cuts CSS animations and transitions
     (tw-animate classes, the sidebar width, the auth drip) to 0.01 ms under reduced motion.
4. Timings: UI transitions 150-250 ms (`DURATION` in `lib/motion.ts`), springs tuned to settle in
   about 200 ms; counters and the training chart draw-in take 450 ms, because a count or a line
   under 250 ms is not readable. Nothing waits for an animation to finish: no exit animations
   block navigation.

Where each piece comes from:

| Effect | Source |
|---|---|
| Dialog, sheet, dropdown, command palette, tooltip transitions | shadcn classes, now live through `tw-animate-css` |
| Sidebar active indicator, page enter, onboarding step slide, OTP feedback | Our motion components (see the last addendum); the OTP shake stays on Motion `useAnimate` |
| Task-page toggle-group indicator | Motion (`layoutId`) in `packages/ui` |
| Settings tabs and the onboarding MCP tabs with a sliding indicator | `motion/tabs.tsx`: shadcn Tabs from `packages/ui` plus a Motion `layoutId` indicator |
| Stat-card counters | `motion/counting-number.tsx`, driven by Motion `animate()` |
| Copy buttons with success feedback | `motion/copy-button.tsx` |
| Training chart draw-in | recharts animation, enabled by `StepChart drawIn` |
| Badges | tw-animate `zoom-in-90`, 150 ms, colours unchanged |

## Consequences

- Tests run with `Element.prototype.animate` removed (`apps/website/test/setup.ts`,
  `packages/ui/test/setup.ts`). happy-dom's Web Animations stub rejects `finished` with an
  `AbortError` when Motion cancels an animation, which surfaced as unhandled errors between tests.
  Without it Motion uses its JavaScript animator, which works in happy-dom.
  `MotionGlobalConfig.skipAnimations` was tried and dropped: with it, `animate()` on a motion
  value never reaches its target, so counters stayed at their start value.
- The motion components are small and few; new effects are written the same way rather than
  installed from a registry.

## Alternatives considered

- **Third-party animated component registries**: rejected where the licence restricts selling or
  redistribution; the code would not be covered by the repository's Apache-2.0 licence.
- **Motion+**: paid and not needed.
- **CSS-only animation**: kept where it is enough (dialogs, badges, the settings panel slide), but
  shared-layout indicators and counters need Motion.

## Links

- Code: `apps/website/src/components/motion/`, `apps/website/src/lib/motion.ts`,
  `packages/ui/src/components/toggle-group.tsx`, `packages/ui/src/components/tabs.tsx`,
  `packages/ui/src/blocks/step-chart.tsx`
- Licence: `LICENSE`, `NOTICE`

## Addendum, 24 Nov 2026: scene gradient and UI Layouts (superseded, see the next addendum)

The sign-in, sign-up and onboarding scene was given an animated gradient (ShaderGradient) and an
animated beam (UI Layouts). Licences checked on 24 Nov 2026:
`@shadergradient/react` declares MIT on npm (the GitHub repo has no root LICENSE file), three.js and
@react-three/fiber are MIT, UI Layouts is MIT.

Decision:

1. `@shadergradient/react` 2.4.20, `three` 0.169.0 (the version ShaderGradient is built against) and
   `@react-three/fiber` 9.8.2 (the React 19 line) are pinned exactly in `apps/website` only.
2. The gradient is loaded with `next/dynamic` and `ssr: false`
   (`apps/website/src/components/auth/scene-gradient.tsx`), so three.js is never in the first
   load. Measured on the production build: the two lazy chunks are 852 KB raw, 223 KB gzipped;
   `/login` and `/signup` first-load JS is 219 kB.
3. Cost caps: pixel density 1, `powerPreference: "low-power"`, 3D lights instead of the HDR
   environment (no environment files are fetched), animation off while the tab is hidden.
4. A still image (`apps/website/public/brand/scene-gradient.jpg`, 17 KB, rendered from the same
   gradient) is painted first and stays the only layer under `prefers-reduced-motion` or when
   WebGL is unavailable (`sceneMode` in `apps/website/src/lib/scene.ts`).
5. UI Layouts' animated beam is adapted into `apps/website/src/components/vendor/uilayouts/` with its
   MIT notice; it draws the example record, distil, gate, serve flow. The grain overlay follows UI
   Layouts' noise effect but is an original SVG filter.

Consequences: if the gradient starts to cost too much on low-end machines, set the scene to the
still image for everyone by returning `"static"` from `sceneMode`; nothing else depends on the
canvas.

## Addendum, 24 Nov 2026: shadcn and one component registry only

Decided on 24 Nov 2026: the dashboard uses only shadcn/ui and the third-party animated component
registry described in the Context. This replaces the previous addendum: UI Layouts and ShaderGradient
are removed. The registry part is superseded by the next addendum.

Removed:

- `@shadergradient/react`, `three` and `@react-three/fiber` (uninstalled; nothing else depended on
  them), the lazy WebGL canvas (`scene-gradient-canvas.tsx`), `sceneMode`, `hasWebGL` and the
  still image `public/brand/scene-gradient.jpg`.
- UI Layouts' animated beam (`vendor/uilayouts/`, its `LICENSE.md` and the `NOTICE` entry).

What replaced each piece:

| Piece | Now |
|---|---|
| Scene gradient field | `.scene-wash` in `packages/ui/src/styles/globals.css`: two radial gradients over a 125deg linear gradient in the light petrol palette, plus the existing CSS-only `.scene-grain`. No JavaScript, no image request. |
| Beam between record, distil, gate and serve | `.flow-connector`: a 2 px CSS line per step, solid when the step is done, a sweeping gradient (`flow-sweep`, 2.4 s) into the step that is checking, dashed into the step that waits. Under `prefers-reduced-motion` the sweep stops and the line is solid. |
| Sidebar active indicator | A highlight with one indicator per sidebar panel; `activeHref` in `lib/nav.ts` picks the active link. |
| Page enter | A fade, keyed by path. |
| Onboarding step transitions | A fade around a slide; `slideFrom` in `lib/motion.ts` maps a step forward to sliding in from the right and a step back to sliding in from the left. |
| OTP form enter and error message | A fade. |
| OTP checklist tick | A zoom (scale 0.6 to 1). |
| Sidebar label fade when the rail expands | A fade. |

`enterFrom` and `ENTERED` were removed from `lib/motion.ts`.

Motion used directly:

- `apps/website/src/components/auth/otp-sign-in.tsx`: the code-input shake on a wrong code
  (`useAnimate`) and `useReducedMotion` to skip it.
- `apps/website/src/components/motion/motion-provider.tsx`: `MotionConfig`, which also configures
  every motion component.
- `apps/website/src/lib/motion.ts`: the `Transition` type for shared timings.
- `apps/website/src/app/(dashboard)/tasks/[slug]/training/[key]/page.tsx`: `useReducedMotion` to
  turn off the recharts draw-in.
- `packages/ui/src/components/toggle-group.tsx`: the toggle-group indicator (`LayoutGroup`,
  `layoutId`).

Bundle size, production build (`next build`), before and after:

| | Before | After |
|---|---|---|
| `/login` first-load JS | 220 kB | 218 kB |
| `/signup` first-load JS | 220 kB | 218 kB |
| Lazy WebGL chunks loaded after first paint on `/login` and `/signup` | 3 chunks, 1,110 KB raw, 272 KB gzipped | none |
| Scene still image | 17 KB | none |
| `.next/static/chunks` total | 3,532 KB | 2,460 KB |

## Addendum, 26 Nov 2026: our own motion components

The repository is going public under Apache-2.0 and backs a commercial product. The vendored
registry code carried a licence condition that forbids selling it, so it could not stay. All of it
was deleted, together with its licence file, its `NOTICE` entry and the registry entry in
`apps/website/components.json`.

Each piece was rewritten from scratch on Motion in `apps/website/src/components/motion/`:

| File | What it does |
|---|---|
| `enter.tsx` | Shared enter effect: a `motion.div`, or the child itself with `asChild` (Radix `Slot` wrapped with `motion.create`). Under reduced motion it renders in its final state. |
| `fade.tsx`, `slide.tsx`, `zoom.tsx` | Opacity, offset and scale enters built on `enter.tsx`. |
| `highlight.tsx` | `Highlight` / `HighlightItem`: one indicator behind the active item, moved between items with a shared `layoutId`. No exit animation, so only the active item ever has an indicator. |
| `tabs.tsx` | shadcn `Tabs` from `packages/ui` plus a `layoutId` indicator behind the active trigger. Works controlled and uncontrolled. |
| `counting-number.tsx` | A motion value animated with `animate()` and rendered through `useTransform`; a new target counts on from the current value. |
| `copy-button.tsx` | shadcn `Button` that writes to the clipboard, swaps the Phosphor copy icon for a check, shows "Copied" for `delay` ms and reports failures through `onCopyError`. |

The sidebar test now checks that the old indicator is gone as well, since the indicator no longer
waits on an exit animation.
