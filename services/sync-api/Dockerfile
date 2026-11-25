# Single-container build: builds lightweight-charts + terminal-web + bundles sync-api with built-in node:sqlite and ws relay.
FROM node:24-alpine AS builder
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json rollup.config.js dts-config.json ./
COPY packages/lwc-toolkit/package.json ./packages/lwc-toolkit/
COPY packages/lwc-plugin-drawing-tools/package.json ./packages/lwc-plugin-drawing-tools/
COPY packages/terminal-domain/package.json ./packages/terminal-domain/
COPY apps/terminal-web/package.json ./apps/terminal-web/
COPY services/sync-api/package.json ./services/sync-api/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY packages/lwc-toolkit ./packages/lwc-toolkit
COPY packages/lwc-plugin-drawing-tools ./packages/lwc-plugin-drawing-tools
COPY packages/terminal-domain ./packages/terminal-domain
COPY apps/terminal-web ./apps/terminal-web
COPY services/sync-api ./services/sync-api
RUN pnpm build:terminal && pnpm --filter @terminal/sync-api deploy --legacy --prod /deploy-sync

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/terminal.db STATIC_DIR=/app/public
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=builder --chown=node:node /deploy-sync/package.json ./package.json
COPY --from=builder --chown=node:node /deploy-sync/node_modules ./node_modules
COPY --from=builder --chown=node:node /deploy-sync/src ./src
COPY --from=builder --chown=node:node /deploy-sync/migrations ./migrations
COPY --from=builder --chown=node:node /build/apps/terminal-web/dist ./public
VOLUME ["/data"]
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health/ready', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.mjs"]
