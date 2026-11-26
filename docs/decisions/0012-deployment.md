# 0012. Deploy the api, website and mcp to Kubernetes with Argo CD, images from GHCR

- **Status:** proposed
- **Date:** 2026-11-24
- **Deciders:** maintainers

## Context

ModelStill has three long-running services: `apps/api` (Bun + Hono, port 8787), `apps/website`
(Next, port 4321) and `apps/mcp` (Bun, port 3104). Until now nothing had a container image, a
manifest or a CI workflow. A Kubernetes cluster with ingress-nginx, cert-manager (DNS-01 through
Cloudflare) and Argo CD, with images built by GitHub Actions into GHCR, is a common shape and the
one the maintainers already operate.

The files describe a reference deployment. Every hostname below is under the project's own
domain, `modelstill.com`; if you self-host, replace it with your domain.

## Decision

1. **Images.** `apps/api/ci/Dockerfile`, `apps/website/ci/Dockerfile` and `apps/mcp/ci/Dockerfile`.
   The build context is the repository root. Each Dockerfile has a `manifests` stage that keeps
   only the `package.json` files, so `bun install` re-runs only when a manifest or `bun.lock`
   changes; then the sources are copied and `turbo build` runs for the website. The api has no
   build step and runs `src/index.ts` under Bun. Images run as the `bun` user (uid 1000) and carry
   a `HEALTHCHECK` for local Docker use.
2. **Base image pin.** `oven/bun:1.2.5-alpine@sha256:7e2dca828e045e25c417b9b476445e4461424bb74df8288956b820057f2ece4c`
   (the image index digest read on 2026-11-24 with `docker buildx imagetools inspect`). 1.2.5 is the
   root `packageManager` version, so CI, images and laptops run the same Bun. Amended by
   [0020](0020-next-16-react-19-2-and-bun-1-3.md): all three images now use Bun 1.3.5 by digest.
3. **Install inside the image is not `--frozen-lockfile`.** The manifests stage gives the install
   only some workspaces, and Bun then rewrites `bun.lock` for that subset. The lockfile is still the
   input (versions resolve from it); CI's `bun install --frozen-lockfile` is the check that it is
   current. The api image keeps dev dependencies because the migrate Job runs `drizzle-kit` from it.
4. **Registry and tags.** `ghcr.io/<owner>/modelstill-{api,website,mcp}`, tagged with the first 7
   characters of the commit and `main`. `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_MCP_URL` are inlined
   into the website at build time from the repository variables `MODELSTILL_PUBLIC_API_URL` and
   `MODELSTILL_PUBLIC_MCP_URL`, defaulting to the placeholder hosts.
5. **Which images to build.** `.github/scripts/changed-apps.sh`: an image is built when its paths
   (`apps/<app>`, `packages`, `package.json`, `bun.lock`, `turbo.json`) differ between the commit
   its kustomization tag names and `HEAD`. A tag that is not a resolvable commit (the initial
   `0000000`) means build it.
6. **Tag bump.** `.github/scripts/bump-tags.sh` writes the new tag and the real GHCR owner into
   `deploy/k8s/modelstill/kustomization.yaml` and pushes to `main`, never moving a tag backwards.
   It is off by default: it runs on push only when the repository variable `MODELSTILL_AUTO_BUMP`
   is `true`, or on a manual dispatch with `bump` ticked. Until then a release is a hand edit of
   the tag.
7. **Kubernetes.** One kustomization at `deploy/k8s/modelstill`, namespace `modelstill`, synced by
   its own Argo Application (`deploy/k8s/argo/modelstill.yaml`), so a failed ModelStill migration
   can never block another application's sync on a shared cluster.
   - One replica each, conservative requests (api 50m/128Mi, website 50m/256Mi, mcp 25m/96Mi) and
     memory limits (512Mi, 768Mi, 256Mi). No CPU limits.
   - Probes: api `GET /health`, mcp `GET /healthz`. The website has no health route and `/`
     redirects to `/tasks`, which reads the api; a TCP probe keeps an api outage from restarting the
     website.
   - Secrets come from the hand-created Secret `modelstill-env` (keys in
     `deploy/k8s/modelstill/secret.example.yaml`, placeholders only). Non-secret settings
     (`PORT`, `CORS_ORIGINS`, `BETTER_AUTH_URL`,
     `MODELSTILL_API_URL`, `PUBLIC_URL`) are literal env on each Deployment. The website reads no secret. The mcp reads only
     `MODELSTILL_API_TOKEN`, optional.
   - The mcp reaches the api inside the cluster at `http://api:8787`.
   - Pods run non-root with `RuntimeDefault` seccomp, no privilege escalation, all capabilities
     dropped and no service-account token. The root filesystem stays writable because `next start`
     writes `.next/cache`.
8. **Migrations.** The Job `api-migrate` runs `bun run db:migrate` (Drizzle, `apps/api/drizzle`)
   from the api image as an Argo `PreSync` hook, recreated each sync, `backoffLimit: 0`. It reads only
   `DATABASE_URL`. If it fails, the sync stops before any pod rolls. Drizzle migrations are forward
   only. The ClickHouse schema (`deploy/clickhouse/schema.sql`) is applied by hand (runbook).
9. **Network.** A default-deny ingress NetworkPolicy for the namespace; api, website and mcp accept
   traffic only from ingress-nginx pods in the `ingress-nginx` namespace, and the api also from mcp
   pods. Egress is not restricted.
10. **TLS.** A namespaced cert-manager `Issuer` (`letsencrypt-dns`) with a Cloudflare DNS-01 solver,
    and one `Certificate` for the three hosts, so the certificate can exist before DNS points at the
    cluster and no cluster-wide `ClusterIssuer` has to change. The Cloudflare token is the Secret
    `cloudflare-api-token` in the `modelstill` namespace.
11. **Ingress.** `app.modelstill.com` to the website, `api.modelstill.com` to the
    api (body cap 10m, 60 s timeouts) and `mcp.modelstill.com` to the mcp on its own
    Ingress with proxy buffering off and 3600 s timeouts, because MCP streams responses over
    long-lived HTTP.
12. **CI.** `.github/workflows/ci.yml` on every PR and push to main: `bun install --frozen-lockfile`,
    `turbo typecheck`, `oxlint`, `turbo test`; for each Python package `uv sync --frozen --extra dev`,
    `ruff check`, `ruff format --check`, `basedpyright`, `pytest -m "not slow"`; and a conventions job
    that runs `.github/scripts/no-comments.sh`, shellcheck and `kubectl kustomize`.
13. **No comments, checked.** `no-comments.sh` feeds every tracked TS/JS file (outside `vendor/`)
    through the repository's comment check, and fails on any `#` comment line in `deploy/k8s`,
    `.github/workflows`, `.github/scripts` and `apps/*/ci`. Python comments are left to review:
    `# noqa: RULE` and `# pyright: ignore[rule]` are allowed there.
14. **Action pins.** Every action is pinned by full commit SHA. The files cannot say which release
    a SHA is, so the map is here:

    | Action | Release | SHA |
    |---|---|---|
    | actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
    | actions/upload-artifact | v7.0.2 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |
    | actions/download-artifact | v8.0.2 | 9000827ccba6bdab643e8b6fd33ac0654aef8333 |
    | oven-sh/setup-bun | v2.2.0 | 0c5077e51419868618aeaa5fe8019c62421857d6 |
    | astral-sh/setup-uv | v10.3.3 | 68559e99cc807c1eb7e9238fd43a15bba460eec2 |
    | docker/setup-buildx-action | v4.4.1 | f87e5991a6d7451dcb8d9637bfbc97413f497069 |
    | docker/login-action | v4.8.0 | 8aa5831fb8d48d8f76594c7ddde61ae58019f550 |
    | docker/build-push-action | v7.4.0 | c3c9e263c25d99ce0380d002d59b67737d91b0dc |

    Tool versions in CI when this was written: Bun 1.2.5, uv 0.13.7, Python 3.12.

## Consequences

- A release is a tag change in git; a rollback is the same edit back (runbook).
- Before a first deploy: pick a domain, choose the GHCR owner, create the database, ClickHouse
  user and Secrets, and register the Argo Application. Each is a placeholder in the files:
  `replace-owner` / `REPLACE_OWNER` in the kustomization and the Argo file,
  `*.modelstill.com` hostnames, `ops@modelstill.com` as the ACME account email.
- The website image is about 1.1 GB because it ships the full workspace `node_modules`. Next's
  `output: "standalone"` would shrink it; not done here because it changes `next.config.mjs` and
  needs its own test.
- The api runs one replica with `RollingUpdate`. If Better Auth or a timer adds per-process state,
  revisit the replica count and strategy.
- The NetworkPolicy assumes the ingress controller runs in namespace `ingress-nginx` with label
  `app.kubernetes.io/name: ingress-nginx`, and that the cluster's CNI enforces NetworkPolicy. If
  either is false, the policy blocks all traffic or is silently ignored.
- The decision stops holding if the reference deployment moves to a managed container platform or
  the services need autoscaling.

## Alternatives considered

- **Add ModelStill to another application's Argo app.** Lost: a ModelStill migration failure would
  gate that application's syncs, and the two would share one Secret.
- **`turbo prune --docker`.** Lost for now: the manifests stage gives the same cached install
  without a second lockfile.
- **HTTP-01 certificates.** Lost: DNS-01 can issue before DNS points at the cluster.
- **Run migrations at api start-up.** Lost: two pods could race, and a failed migration would
  crash-loop the api instead of stopping the sync.
- **Actions pinned by tag only.** Lost: a tag can be moved; a SHA cannot.

## Links

- Runbooks: `../runbooks/deploy.md`
- Code: `apps/api/ci/Dockerfile`, `apps/website/ci/Dockerfile`, `deploy/k8s/modelstill/`,
  `deploy/k8s/argo/modelstill.yaml`, `.github/workflows/ci.yml`, `.github/workflows/images.yml`,
  `.github/scripts/`
