# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN pnpm run build \
  && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ARG APP_VERSION=0.19.0
ARG GIT_COMMIT=unknown
ARG INSTALLED_CHANNEL=stable

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY portal ./portal
COPY LICENSE COMMERCIAL_USE.md ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV GIT_COMMIT=${GIT_COMMIT}
ENV INSTALLED_CHANNEL=${INSTALLED_CHANNEL}

LABEL org.opencontainers.image.title="RoonIA" \
  org.opencontainers.image.description="Roon bridge with HTTP/MCP APIs and administration portal" \
  org.opencontainers.image.source="https://github.com/LINEdev-ipc/roon-ai-bridge" \
  org.opencontainers.image.version="${APP_VERSION}" \
  org.opencontainers.image.revision="${GIT_COMMIT}" \
  org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

EXPOSE 3000
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
