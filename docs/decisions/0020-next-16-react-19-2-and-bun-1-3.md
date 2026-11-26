# 0020. Run every React app on Next 16.2.9 and React 19.2.7, and every Bun on 1.3.5

- **Status:** accepted
- **Date:** 2026-11-25
- **Deciders:** maintainers

## Context

On 2026-11-25 the monorepo ran two framework lines side by side:

- `apps/docs` (Fumadocs 16, added in the docs-site merge) needs Next 16 and React 19.2, and ran
  Next 16.2.9 with React and React DOM 19.2.7.
- `apps/website` ran Next 15.5.28 with React 19.1.0, and `packages/ui` declared React 19.1.0 as its
  peer and dev dependency.
- Every workspace held `@types/react` and `@types/react-dom` at 19.1.2, because the 19.2 types
  had broken the `packages/ui` typecheck while the website and ui still resolved React 19.1.
- `apps/docs/next.config.mjs` set `typescript.ignoreBuildErrors`, so its production build did not
  type-check.

The lockfile therefore held two copies of `next`, `react` and `react-dom`. The shared ui package was
compiled against one React and rendered by another inside the docs app.

Bun drifted too. The root `packageManager`, CI (`.github/workflows/ci.yml`) and the api and website
images ran Bun 1.2.5, the mcp image used the floating `oven/bun:1.3-alpine` tag, and `bun.lock` had
been written by Bun 1.3.5 on a developer laptop (it carries `"configVersion": 1`). Bun 1.2.5 still
accepted that lockfile with `--frozen-lockfile` on 2026-11-25, but laptops (1.3.5, isolated
linker) and CI or images (1.2.5, hoisted linker) laid out `node_modules` differently.

Separately, a fresh clone failed `bun run test` until the shared packages were built: the
`@modelstill/logger`, `telemetry`, `utils`, `redis-module` and `clickhouse-failover` manifests
point `module` and `types` at `dist/`, and the turbo `test` task had no build dependency.
`clickhouse-failover` (imports `@modelstill/logger`) and `logger` (its test imports
`@modelstill/telemetry`) failed with `Cannot find module`.

## Decision

1. Every workspace that uses React or Next pins the same exact versions: `next` 16.2.9, `react` and
   `react-dom` 19.2.7, `@types/react` 19.2.18, `@types/react-dom` 19.2.7. This covers
   `apps/website`, `apps/docs` and `packages/ui` (peer and dev dependencies). `bun.lock` holds one
   copy of each. A change to any of them changes all of them, in one ADR.
2. `apps/docs` builds with type checking on (`typescript.ignoreBuildErrors` removed).
3. Bun is 1.3.5 everywhere: root `packageManager`, the CI `bun-version`, and all three images on
   `oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc`
   (the image index digest read from Docker Hub on 2026-11-25; the same method returned the
   1.2.5 digest recorded in [0012](0012-deployment.md)). This amends point 2 of 0012.
4. The turbo `test` task depends on `^build`, so tests of a package always run against built
   `dist/` output of the workspace packages it imports.

## Consequences

Next 15 to 16 changes checked against the
[version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16):

- Async request APIs: the website already awaited `params` and `searchParams` in server pages
  (`login`, `signup`, `onboarding/[step]`) and read route params in client pages with
  `useParams`. No change.
- `middleware` to `proxy`: the website has no middleware. No change.
- `next lint` removal: the repo lints with oxlint and never called `next lint`. No change.
- Turbopack is the default for `next build`: neither app has a custom webpack config. The website
  builds with Turbopack.
- `next build` rewrote `apps/website/tsconfig.json` with its mandatory `jsx: react-jsx` and the
  `.next/dev/types/**/*.ts` include (dev output moved to `.next/dev`). Both are committed.
- Not used by the website, so no change: `next/image` default changes, AMP, runtime config,
  `revalidateTag`, PPR flags, parallel routes, metadata image routes, `scroll-behavior` override
  (the only rule is the reduced-motion `auto` in `packages/ui/src/styles/globals.css`).

The `packages/ui` typecheck break with the 19.2 types did not reappear once React and its types
resolve to one copy each. The earlier failure is recorded as seen with mixed 19.1 and 19.2 copies
and was not reproduced on 2026-11-25.

Verified on 2026-11-25 on branch `align-frameworks`: `bun run test`, `bun run typecheck`,
`bun run lint`, `next build` for `apps/website` and `apps/docs`, and, in a fresh clone,
`bunx bun@1.3.5 install --frozen-lockfile` followed by `bun run test` (11 tasks, shared packages
built first).

Costs and debt:

- `bun run test` now builds the shared packages first (tsup, a few seconds; turbo caches builds).
- A Bun upgrade now has to move four places together: `packageManager`, the CI `bun-version` and
  the three Dockerfiles. 0012's "Tool versions in CI" line is historical.
- Fumadocs or any future React app sets the floor for the whole repo. If a later Fumadocs needs a
  React the dashboard cannot take, this decision has stopped holding and needs a new ADR.

## Alternatives considered

- Keep the website on Next 15 and React 19.1. Lost: two Reacts in one lockfile, `packages/ui`
  rendered by a React it was not type-checked against, and types held back for every app.
- Regenerate `bun.lock` with Bun 1.2.5 instead of bumping CI. Lost: laptops run 1.3.5 and the
  next local install rewrites the lockfile again, and the linkers would still differ.
- Make tests resolve package source (a `bun` export condition pointing at `src/`). Lost: it also
  changes what the api resolves at runtime under Bun in production, which is out of scope here.

## Links

- Code: `apps/website/package.json`, `apps/docs/package.json`, `apps/docs/next.config.mjs`,
  `packages/ui/package.json`, `apps/website/tsconfig.json`, `turbo.json`, `package.json`,
  `.github/workflows/ci.yml`, `apps/api/ci/Dockerfile`, `apps/website/ci/Dockerfile`,
  `apps/mcp/ci/Dockerfile`
- Decisions: [0012](0012-deployment.md)
