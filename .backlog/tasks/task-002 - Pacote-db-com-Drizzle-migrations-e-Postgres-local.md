---
id: TASK-002
title: 'Pacote db com Drizzle, migrations e Postgres local'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 04:14'
labels:
  - db
  - infra
milestone: m-0
dependencies:
  - TASK-001
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Persistência base (doc-002): packages/db com Drizzle e migrations sobre Postgres (Q16), usada por todas as fases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migrations aplicam do zero num Postgres vazio e são idempotentes em reexecução
- [ ] #2 Server consegue conectar e executar consulta usando o pacote db
- [x] #3 Existe comando para gerar e aplicar migrations a partir da raiz
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
1. packages/db: drizzle-orm + postgres.js; schema mínimo (app_meta); createDb/ping/runMigrations (pasta migrations resolvida relativa ao módulo, enviada no pacote).
2. drizzle.config.ts + migrations geradas; scripts raiz db:generate/db:migrate.
3. docker-compose.dev.yml (Postgres 17) + .env.example.
4. Teste de integração (migrations 2x + query), skip local sem DATABASE_URL, falha em CI.
5. CI: service postgres:17 no job coverage.
6. pnpm quality, evidências, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (pnpm quality, local com Postgres 17 via docker-compose.dev.yml)
Lint 0 | Race 0 | Typecheck ok | Coverage branch 97.82% (>=79) | E2E 8 ok/0 falha | Duplicação 0% | Dead code 0 | Audit high+ 0 → Passou.

## AC → evidência
| AC | Evidência | Status |
|---|---|---|
| #1 migrations do zero + idempotentes | packages/db/src/db.integration.test.ts: dropa schema drizzle + app_meta, roda runMigrations 2x e confere contagem igual em drizzle.__drizzle_migrations; também `pnpm db:migrate` 2x no Postgres dev (`\dt` mostra app_meta, 1 linha de migration). CI roda com service postgres:17 (TEST_DATABASE_URL). | ✅ |
| #2 server conecta e consulta | Provado no pacote (createDb + ping + insert/select no teste de integração). **Pendente**: wiring Nest (DbModule + health incluindo db) em apps/server, a ser feito no rebase sobre TASK-003 (em paralelo). | ⏳ não marcado |
| #3 comando raiz gerar/aplicar | `pnpm db:generate` gerou migrations/0000_app_meta.sql; `pnpm db:migrate` aplicou (saída 'migrations aplicadas'). | ✅ |

## Decisões
- postgres.js com types.bigint = BigInt: int8 volta como bigint (Q20); teste cobre 2^53+1.
- Migrations enviadas no pacote (files: dist, migrations), resolvidas relativas ao módulo (`../migrations`) — funciona de src e dist.
- Única tabela: app_meta (chave/valor) só para provar pipeline.
- Teste de integração pula localmente sem URL (aviso), mas lança erro se CI estiver setado.
- Compose dev-only: docker-compose.dev.yml (porta via POSTGRES_PORT); produção fica na TASK-005.

## Skills
task-done-check (adaptado: sem UI, sem Playwright visual). security-review não aplicável (não toca auth/ledger/saque).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
packages/db com Drizzle 0.45 + postgres.js: createDb/ping/runMigrations/schema, migration inicial app_meta, scripts raiz db:generate/db:migrate, docker-compose.dev.yml (Postgres 17) e .env.example; CI com service postgres:17. Verificado por teste de integração (migrations 2x idempotentes, query, bigint) e pnpm quality verde. AC#2 aguarda wiring Nest após TASK-003.
<!-- SECTION:FINAL_SUMMARY:END -->
