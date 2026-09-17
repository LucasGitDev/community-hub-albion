# syntax=docker/dockerfile:1.7
# Imagem única: API + bot (Nest/Necord) + SPA estática (doc-002). TASK-005.

FROM node:22.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# --- dependências (cache por lockfile) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- build de server (+ db, shared) e web ---
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY apps apps
COPY packages packages
COPY assets assets
RUN pnpm exec turbo run build --filter=@albion-hub/server... --filter=@albion-hub/web
# Pacote do server só com dependências de produção e workspace deps compilados (dist + migrations).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @albion-hub/server deploy --prod --legacy /out \
 && rm -rf /out/src /out/tsconfig*.json /out/.env.example

# --- runtime ---
FROM node:22.20-alpine AS runtime
ENV NODE_ENV=production PORT=3000 WEB_DIST_DIR=/app/web RUN_MIGRATIONS=true BUFFUNFA_EMOJI_FILE=/app/assets/buffunfa_emoji_simples_128.png
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
# PNG do emoji da Buffunfa: o bot tenta criá-lo na guild no boot (F6-28).
COPY --from=build --chown=node:node /repo/assets ./assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
