---
id: TASK-005
title: Imagem Docker multi-stage e docker compose com Postgres
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:29'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-002
  - TASK-004
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deploy em VPS própria via docker compose (Q16): uma imagem com bot + API + SPA e Postgres. Critério de pronto da F0 (doc-004).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docker compose up sobe app e Postgres e o app aplica migrations ou falha de forma clara
- [ ] #2 Um único container responde health da API, serve a SPA e conecta o bot
- [x] #3 Imagem final não contém dependências de dev nem código-fonte TS desnecessário
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migrations no boot (RUN_MIGRATIONS) com falha clara. 2. Dockerfile multi-stage (deps, build turbo, pnpm deploy --prod, runtime alpine não-root com healthcheck). 3. docker-compose.yml produção (app + postgres). 4. Verificar imagem e compose de verdade.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (com Postgres): lint 0, race 0, typecheck ok, coverage 97.61%, e2e 10/10, dup 0%, dead 0, vulns 0.
Evidências:
- AC#1: docker compose up --build --wait (app healthy + db healthy); \dt no Postgres mostra app_meta, users, user_roles, sessions (migrations aplicadas no boot). Falha clara: DB com senha errada -> 'Falha ao aplicar migrations do banco: password authentication failed for user "albion" (...)', exit 1 (boot/migrations.test cobre mensagem e mascara credenciais).
- AC#2: único container app: curl /api/health -> {"status":"ok","db":"up","bot":"offline"} 200; / e /carteira 200 text/html; /api/nope 404 JSON. Bot: com DISCORD_BOT_ENABLED=true e token falso o container sai com 'An invalid token was provided' (login tentado); conexão real pendente do token do usuário.
- AC#3: imagem 204MB; /app só tem dist, node_modules, package.json, web; nenhum .ts fora de .d.ts; typescript, vitest, @nestjs/testing, supertest, tsc-watch, drizzle-kit, eslint, turbo ausentes; roda como usuário node.
Decisões: node:22.20-alpine; pnpm deploy --prod --legacy; WEB_DIST_DIR=/app/web; HEALTHCHECK via fetch no /api/health (503 quando banco cai); compose exige POSTGRES_PASSWORD/DISCORD_TOKEN/GUILD_ID (erro claro do compose se faltar). Gate agora avisa quando roda sem TEST_DATABASE_URL.
Skills: task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Imagem Docker única (API + bot + SPA) multi-stage sem dev deps, compose de produção com Postgres e migrations aplicadas no boot com falha clara. Verificado com build e compose reais, inspeção da imagem e pnpm quality. Bot real pendente do token.
<!-- SECTION:FINAL_SUMMARY:END -->
