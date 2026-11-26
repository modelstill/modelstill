# Deploy ModelStill to Kubernetes

The manifests, Dockerfiles and workflows describe a reference deployment. The hostnames
and email below are under the project's own domain, `modelstill.com`, and the image owner is a
placeholder: if you self-host, replace both as part of the prerequisites.
Why it is built this way: [ADR 0012](../decisions/0012-deployment.md).

| Piece | Where |
|---|---|
| Images | `apps/api/ci/Dockerfile`, `apps/website/ci/Dockerfile`, `apps/mcp/ci/Dockerfile` |
| Manifests | `deploy/k8s/modelstill/` (kustomization, namespace `modelstill`) |
| Argo Application | `deploy/k8s/argo/modelstill.yaml` |
| Secret keys | `deploy/k8s/modelstill/secret.example.yaml` (placeholders only) |
| CI | `.github/workflows/ci.yml`, `.github/workflows/images.yml`, `.github/scripts/` |

## Prerequisites

Do these once, in order. Each replaces a placeholder.

1. **Domain.** If you self-host, pick a domain you own and add the zone to Cloudflare. Replace
   `modelstill.com` with it in `deploy/k8s/modelstill/*.yaml` (Ingress, Certificate,
   Issuer email, `CORS_ORIGINS`, `BETTER_AUTH_URL`, `PUBLIC_URL`) and set the repository variables
   `MODELSTILL_PUBLIC_API_URL` and `MODELSTILL_PUBLIC_MCP_URL`.
2. **Cloudflare token for DNS-01.** A user token with Zone:DNS:Edit and Zone:Zone:Read, scoped to the
   zone. It goes into the Secret `cloudflare-api-token` (step 7).
3. **Cluster.** A cluster with ingress-nginx (namespace `ingress-nginx`), cert-manager and Argo CD
   (namespace `argocd`), and a CNI that enforces NetworkPolicy. Check the ingress controller's
   labels match the NetworkPolicy:

   ```sh
   kubectl get pods -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
   ```

4. **GHCR.** Choose the GitHub owner the repository lives under. Replace `replace-owner` in
   `deploy/k8s/modelstill/kustomization.yaml` and `REPLACE_OWNER` in
   `deploy/k8s/argo/modelstill.yaml` (GHCR names are lowercase). Packages are private by default;
   create a read-only pull token (a fine-grained or classic PAT with `read:packages`).
5. **Postgres.** A database and an owner role for the api, reachable from the cluster:

   ```sql
   CREATE ROLE modelstill LOGIN PASSWORD '<generated>';
   CREATE DATABASE modelstill OWNER modelstill;
   ```

   `DATABASE_URL=postgres://modelstill:<generated>@<host>:5432/modelstill`. The migrate Job creates
   the tables.
6. **ClickHouse.** The api only reads `modelstill.serving_events`. Apply the schema, then a
   read-only user:

   ```sh
   clickhouse-client --multiquery < deploy/clickhouse/schema.sql
   ```

   ```sql
   CREATE USER modelstill_reader IDENTIFIED WITH sha256_password BY '<generated>';
   GRANT SELECT ON modelstill.* TO modelstill_reader;
   ```

   The schema is idempotent (`IF NOT EXISTS`); re-apply it after any change to `schema.sql`.
7. **Namespace and Secrets.** Created by hand, never committed. Copy the example to a file outside
   the repository, fill in real values, apply it, delete the file:

   ```sh
   kubectl create namespace modelstill
   cp deploy/k8s/modelstill/secret.example.yaml /tmp/modelstill-secrets.yaml
   kubectl apply -f /tmp/modelstill-secrets.yaml && rm /tmp/modelstill-secrets.yaml
   kubectl create secret docker-registry ghcr -n modelstill \
     --docker-server=ghcr.io --docker-username=<owner> --docker-password=<read-only token>
   ```

   Keys in `modelstill-env`: `DATABASE_URL`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`,
   `CLICKHOUSE_PASSWORD`, `MODELSTILL_API_TOKEN` (`openssl rand -hex 32`), `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`), and optionally
   `CLICKHOUSE_DATABASE` (default `modelstill`; ADR 0019). Run the Postgres migrations
   (`bun run db:migrate` in `apps/api`) before rolling out an api that adds one. The Argo app does not create
   the namespace (`CreateNamespace=false`) and does not own these Secrets, so deleting the app never
   deletes them.
8. **GitHub settings.** Actions must be allowed to write packages (default for `GITHUB_TOKEN` with
   `packages: write`). Optional: the variable `MODELSTILL_AUTO_BUMP=true` to have `images.yml` commit
   new tags to `main`; if `main` is protected, a deploy key with write access as the secret
   `DEPLOY_BUMP_KEY`.

## First deploy

1. **Build the images.** Merge to `main` (or run the Images workflow by hand with
   `apps=api,website,mcp`). Check the packages exist:
   `ghcr.io/<owner>/modelstill-api:<sha7>`, `-website`, `-mcp`.
2. **Point the kustomization at them.** Run the Images workflow with `bump` ticked, or edit
   `deploy/k8s/modelstill/kustomization.yaml` by hand: set `newName` to the real owner and `newTag`
   to the quoted short SHA for all three images. Always quote the tag: an all-digit SHA is otherwise a
   YAML number.
3. **Render before you apply.**

   ```sh
   kubectl kustomize deploy/k8s/modelstill | less
   ```

4. **Register the Argo Application.**

   ```sh
   kubectl apply -f deploy/k8s/argo/modelstill.yaml
   ```

   The first sync runs `api-migrate` (PreSync) and, only if it succeeds, the Deployments, Services,
   NetworkPolicies, Issuer, Certificate and Ingresses.
5. **Watch it.**

   ```sh
   kubectl -n argocd get application modelstill
   kubectl -n modelstill logs job/api-migrate
   kubectl -n modelstill get pods,certificate,ingress
   ```

   The Certificate is `Ready` once DNS-01 succeeds; it does not need DNS records pointing at the
   cluster.
6. **DNS.** Point `app`, `api` and `mcp` at the ingress controller's address (proxied or DNS-only in
   Cloudflare; with proxied records set SSL mode to Full (strict)).
7. **Smoke.**

   ```sh
   curl -fsS https://api.modelstill.com/health
   curl -fsS https://mcp.modelstill.com/healthz
   curl -fsSI https://app.modelstill.com/
   ```

## Releasing

Merging to `main` builds the changed images. With `MODELSTILL_AUTO_BUMP=true` the workflow commits
the new tags and Argo syncs them; otherwise edit the tags by hand as in First deploy step 2. A sync
runs pending Drizzle migrations first.

## Rollback

1. **Code only.** Set the image's `newTag` in `deploy/k8s/modelstill/kustomization.yaml` back to the
   last good short SHA (`git log -p deploy/k8s/modelstill/kustomization.yaml` shows them) and merge.
   Argo rolls back within its poll interval; `argocd app sync modelstill` makes it immediate. Then
   revert the bad commit on `main`, or the next image build ships it again.
2. **Faster, temporary.** `kubectl -n modelstill rollout undo deployment/<api|website|mcp>`. Argo's
   self-heal puts git's tag back on its next sync, so follow with step 1.
3. **Migrations are forward only.** Rolling the api image back does not undo a migration. If the old
   code cannot read the new schema, write a new forward migration that restores compatibility; do not
   edit or delete applied files in `apps/api/drizzle`.
4. **Stop everything.** Set `replicas: 0` in the three Deployments in git and merge. Do not delete the
   Argo Application to stop the services: with `prune` on, that removes every resource it manages.

## Validating changes locally

```sh
kubectl kustomize deploy/k8s/modelstill > /dev/null
bash .github/scripts/no-comments.sh
shellcheck .github/scripts/*.sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -no-color
docker build -f apps/api/ci/Dockerfile -t modelstill-api:local .
docker build -f apps/website/ci/Dockerfile -t modelstill-website:local \
  --build-arg NEXT_PUBLIC_API_URL=https://api.modelstill.com \
  --build-arg NEXT_PUBLIC_MCP_URL=https://mcp.modelstill.com .
```

The migrate Job's command can be checked against a throwaway Postgres:
`docker run --rm -w /app/apps/api -e DATABASE_URL=... modelstill-api:local bun run db:migrate`.

## Documentation site

The docs (`apps/docs`) are a static export served by Cloudflare at `docs.modelstill.com`. They
do not need the cluster.

```bash
cd apps/docs
bun run deploy
```

`deploy` builds the static site into `out/` with `DOCS_STATIC_EXPORT=1` and uploads it with the
Cloudflare CLI (`cf`, signed in with `cf auth login`). The Worker name, the asset handling and the
custom domain are in `apps/docs/cloudflare.config.ts`. The short links (`/cli`, `/mcp`, `/api`)
are in `apps/docs/public/_redirects`, because a static export ignores Next.js redirects. Search
runs in the browser from `/search-index.json`. To self-host the docs, change the domain in
`cloudflare.config.ts` and `NEXT_PUBLIC_DOCS_URL` in the `build:static` script.
