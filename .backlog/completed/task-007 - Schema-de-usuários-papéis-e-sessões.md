---
id: TASK-007
title: 'Schema de usuários, papéis e sessões'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:23'
labels:
  - db
  - auth
milestone: m-1
dependencies:
  - TASK-002
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Base de dados para auth (Q13): usuários vinculados ao Discord, atribuição de papéis member/caller/staff/admin e sessões.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration cria estruturas de usuário (id Discord único), papéis atribuídos e sessão
- [x] #2 Usuário pode ter mais de um papel
- [x] #3 Testes cobrem unicidade do id Discord
- [x] #4 security-review executado sem achados críticos
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
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema Drizzle em packages/db: users (uuid, discord_id unique), role enum de ROLES do shared, user_roles (PK composta), sessions (token_hash sha256 unique, índices user_id/expires_at).
2. Gerar migration com drizzle-kit (pnpm db:generate).
3. Helpers mínimos para TASK-008/011: hashSessionToken, generateSessionToken, isSessionExpired (unit), upsertUserByDiscordId, grantRole/revokeRole/listRoles, createSession/findValidSession/revokeSession (integração).
4. Testes integração: migrations do zero, unicidade discord_id, múltiplos papéis, papel duplicado, cascade, token_hash único.
5. security-review, pnpm quality, notas, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (pnpm quality, local, TEST_DATABASE_URL real PG17)
Lint 0 | Race 0 | Typecheck ok | Coverage branch 97.33% (>=79) | E2E 8 ok | Dup 0% | Deadcode 0 | Audit high+ 0 -> Passou.

## AC -> evidência
| AC | Evidência |
|---|---|
| #1 | migrations/0001_auth_users_roles_sessions.sql (drizzle-kit generate); teste 'aplica migrations do zero' em banco com schema public recriado |
| #2 | teste 'usuário pode ter mais de um papel (AC#2)' + 'mesmo papel duas vezes é rejeitado pela PK' |
| #3 | testes 'discord_id é único: insert duplicado falha com unique_violation (AC#3)' (23505) e 'upsert por discord_id atualiza o mesmo usuário' |
| #4 | security-review: skill invocada; revisão do diff do branch sem achados High/Medium (ver abaixo) |

## Decisões
- users.id uuid gen_random_uuid(): id exposto na API (TASK-011) não enumerável; discord_id text unique (snowflake não cabe com segurança em number JS).
- role pg enum gerado de ROLES (@albion-hub/shared) = fonte única; shared ganhou condição de export 'default' para o loader CJS do drizzle-kit.
- user_roles PK (user_id, role); user_id cascade; granted_by FK set null (auditoria sobrevive à remoção do concedente).
- sessions: só token_hash sha256 hex unique (token 256 bits base64url, sem salt/KDF por ter alta entropia); índices user_id e expires_at; sem IP/user-agent (minimização de PII).
- Helpers para TASK-008/011: upsertUserByDiscordId, grantRole (idempotente)/revokeRole/listRoles, createSession/findValidSession (filtra expiradas, atualiza last_seen_at)/revokeSession; puros generateSessionToken/hashSessionToken/isSessionExpired com unit test.
- Testes de integração de auth no mesmo arquivo do db para não haver corrida de reset entre arquivos paralelos.

## security-review
Nenhum achado High/Medium: queries parametrizadas (drizzle/sql template), token via crypto.randomBytes(32), lookup por hash (token em claro não persiste), expiração checada no WHERE, cascade evita sessões órfãs. Obs: o contexto automático da skill leu a checkout principal (main, diff vazio), então a análise foi feita sobre git diff origin/main do worktree.

Skills: task-done-check, security-review
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Schema users/user_roles/sessions (migration 0001) com enum de papéis do shared, token de sessão só como hash sha256 e helpers de acesso; verificado por testes de integração em Postgres 17 (unicidade discord_id, múltiplos papéis, cascade, token_hash único) e pnpm quality verde.
<!-- SECTION:FINAL_SUMMARY:END -->
