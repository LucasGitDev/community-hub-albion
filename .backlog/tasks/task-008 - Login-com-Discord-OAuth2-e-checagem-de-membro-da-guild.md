---
id: TASK-008
title: Login com Discord OAuth2 e checagem de membro da guild
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:33'
labels:
  - auth
  - backend
milestone: m-1
dependencies:
  - TASK-007
  - TASK-003
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel para todos (Q3) exige login Discord OAuth2 e só aceita quem é membro do GUILD_ID (Q4). Sessão segura.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Usuário membro da guild conclui login e recebe sessão
- [x] #2 Usuário que não é membro da guild é recusado com mensagem PT-BR
- [x] #3 Logout invalida a sessão
- [x] #4 Sessão usa cookie httpOnly, secure em produção, com proteção CSRF/state no OAuth
- [x] #5 security-review executado sem achados críticos
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
1. env: DISCORD_CLIENT_ID/SECRET, PUBLIC_URL, SESSION_TTL_DAYS, BOOTSTRAP_ADMIN_DISCORD_IDS (zod).
2. shared: códigos de erro de login + textos PT-BR.
3. server/src/domain/auth: state OAuth (gerar/verificar timing-safe), opções de cookie por env, parse de cookie, URL authorize, checagem same-origin p/ logout.
4. DiscordOAuthClient injetável (fetch): troca de code, /users/@me, membro via /users/@me/guilds/{GUILD_ID}/member.
5. AuthController /api/auth: discord, discord/callback, logout (204, same-origin), me (401/200).
6. Testes unitários + HTTP com fake Discord e Postgres real (DB isolado).
7. .env.example, security-review, quality gate, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (pnpm quality, TEST_DATABASE_URL, commit após rebase em origin/main 8c0e57d)
Lint 0 ✅ | Race 0 ✅ | Typecheck ok ✅ | Coverage branch 98.19% (≥79) ✅ | E2E 10 ok ✅ | Duplicação 0% ✅ | Dead code 0 ✅ | Audit high 0 ✅

## Design
- GET /api/auth/discord: state 256 bits em cookie ah_oauth_state (httpOnly, SameSite=Lax, Path=/api/auth/discord, 10 min, secure em prod) → 302 discord.com/oauth2/authorize scope 'identify guilds.members.read'.
- GET /api/auth/discord/callback: state comparado em tempo constante antes de ler code/error; cookie de state apagado sempre; troca code, /users/@me e GET /users/@me/guilds/GUILD_ID/member (404 = não membro). Não membro → 302 /entrar?erro=nao-membro sem criar usuário. Cancelado → erro=cancelado; falha → erro=oauth. Sucesso: upsert user, member (+admin se BOOTSTRAP_ADMIN_DISCORD_IDS), revoga sessão anterior do cookie, cria sessão, cookie ah_session (httpOnly, SameSite=Lax, Path=/, Max-Age=SESSION_TTL_DAYS, secure em produção) → 302 /carteira.
- GET /api/auth/me: 401 sem sessão válida; 200 {user, roles}; Cache-Control no-store.
- POST /api/auth/logout: CSRF = Sec-Fetch-Site same-origin ou Origin == PUBLIC_URL (sem ambos → 403) + SameSite=Lax; revoga sessão, limpa cookie, 204.
- Discord via DiscordOAuthClient injetável (fetch global, timeout 10s, zod nas respostas, erro sem corpo).
- Códigos de erro + textos PT-BR em @albion-hub/shared (LOGIN_ERROR_MESSAGES/loginErrorMessage) para TASK-010.
- Env novas (zod): DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL (origem; https obrigatório em produção), SESSION_TTL_DAYS (1-90, default 30), BOOTSTRAP_ADMIN_DISCORD_IDS. apps/server/.env.example, .env.example e docker-compose.yml atualizados.

## AC → evidência
- AC#1: apps/server/src/auth/auth.http.test.ts 'membro da guild conclui login...' (Postgres real + Discord SIMULADO por fake). Verificação real pendente do usuário: criar app no Developer Portal, redirect PUBLIC_URL/api/auth/discord/callback, preencher env, abrir /api/auth/discord.
- AC#2: auth.http.test.ts 'não membro é recusado...' (redirect erro=nao-membro, sem usuário/sessão) + packages/shared/src/auth-errors.test.ts (mensagem PT-BR).
- AC#3: auth.http.test.ts 'logout do mesmo site revoga a sessão...' (204, cookie limpo, me 401, linha apagada).
- AC#4: auth.http.test.ts (flags do cookie, state divergente/ausente recusado sem chamar Discord, logout cross-site 403) + domain/auth.test.ts (secure em produção) + curl no dist/main.js compilado (Set-Cookie HttpOnly; SameSite=Lax; callback com state errado → erro=oauth; logout Origin estranho 403, mesma origem 204).
- AC#5: security-review (skill leu checkout principal com diff vazio; checklist aplicado manualmente em git diff do branch por subagente): nenhum achado crítico/alto. Sugestões defense-in-depth registradas: sessão de 30 dias não revalida membro da guild; admin bootstrap não é removido ao tirar id da env; callback não transacional.

Skills: task-done-check, security-review. Sem UI (DoD#4 N/A).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Login Discord OAuth2 em /api/auth (state CSRF em cookie, checagem de membro de GUILD_ID, sessão em cookie httpOnly/secure em prod, me, logout com checagem de origem), env validada e bootstrap de admin. Verificado com testes HTTP (Postgres real + Discord falso), unitários, curl no server compilado e pnpm quality verde; OAuth real depende de credenciais do usuário.
<!-- SECTION:FINAL_SUMMARY:END -->
