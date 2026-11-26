FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS manifests
WORKDIR /app
COPY packages packages
COPY apps/mcp apps/mcp
RUN find . -type f ! -name package.json -delete && find . -type d -empty -delete

FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS build
WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY --from=manifests /app ./
RUN bun install --ignore-scripts

COPY packages packages
COPY apps/mcp apps/mcp
RUN bunx turbo build --filter @modelstill/mcp

FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc
WORKDIR /app
COPY --from=build /app/apps/mcp/dist ./dist
ENV PORT=3104
EXPOSE 3104
USER bun
CMD ["bun", "run", "dist/index.js"]
