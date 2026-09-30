FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate
# Values below exist only while compiling server bundles; runtime remains fail-closed.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=build-only-auth-secret-at-least-32-characters \
    CURSOR_SIGNING_SECRET=build-only-cursor-secret-at-least-32-characters \
    APP_BASE_URL=https://build.invalid \
    npm run build -- --webpack

FROM builder AS production-dependencies
RUN npm pkg delete devDependencies.prisma \
    && npm prune --omit=dev --legacy-peer-deps \
    && npm cache clean --force

# The Prisma CLI is intentionally confined to this one-shot migration image.
FROM builder AS migration
ENV NODE_ENV=production
USER node
ENTRYPOINT ["sh", "/app/deploy/scripts/runtime-entrypoint.sh"]
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 esniffer \
    && useradd --system --uid 10001 --gid esniffer --home-dir /app esniffer
COPY --from=production-dependencies --chown=esniffer:esniffer /app/node_modules ./node_modules
COPY --from=builder --chown=esniffer:esniffer /app/.next ./.next
COPY --from=builder --chown=esniffer:esniffer /app/public ./public
COPY --from=builder --chown=esniffer:esniffer /app/package.json /app/package-lock.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=builder --chown=esniffer:esniffer /app/app ./app
COPY --from=builder --chown=esniffer:esniffer /app/lib ./lib
COPY --from=builder --chown=esniffer:esniffer /app/shared ./shared
COPY --from=builder --chown=esniffer:esniffer /app/worker ./worker
COPY --from=builder --chown=esniffer:esniffer /app/prisma ./prisma
COPY --from=builder --chown=esniffer:esniffer /app/deploy/scripts ./deploy/scripts
USER esniffer
EXPOSE 3000 8081
CMD ["node", "node_modules/next/dist/bin/next", "start"]
