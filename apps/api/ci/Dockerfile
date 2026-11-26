FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS manifests
WORKDIR /app
COPY packages packages
COPY apps/api apps/api
RUN find . -type f ! -name package.json -delete && find . -type d -empty -delete

FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY --from=manifests /app ./
RUN bun install

COPY packages packages
COPY apps/api apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV PORT=8787
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["bun", "run", "src/index.ts"]
