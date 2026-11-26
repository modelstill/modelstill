FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS manifests
WORKDIR /app
COPY packages packages
COPY apps/website apps/website
RUN find . -type f ! -name package.json -delete && find . -type d -empty -delete

FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY --from=manifests /app ./
RUN bun install

FROM deps AS build
COPY packages packages
COPY apps/website apps/website
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MCP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MCP_URL=$NEXT_PUBLIC_MCP_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN bunx turbo build --filter @modelstill/website

FROM deps
COPY packages packages
COPY apps/website apps/website
COPY --from=build --chown=bun:bun /app/apps/website/.next apps/website/.next

WORKDIR /app/apps/website
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER bun
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4321/', { redirect: 'manual' }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "run", "start"]
