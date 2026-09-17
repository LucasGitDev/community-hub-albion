---
id: TASK-043
title: Lista de membros para admin com validação de nick no Albion
status: Done
assignee:
  - '@claude'
created_date: '2026-09-16 03:56'
updated_date: '2026-09-16 15:56'
labels:
  - frontend
  - backend
dependencies: []
priority: high
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin precisa ver todos os membros do painel num só lugar, com nick, tag de guilda, papéis e se o nick foi encontrado na API do Albion (TASK-016). Base para acompanhar a importação (TASK-042) e achar nick errado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admin vê lista de membros com nick, tag de guilda, papéis e data de entrada
- [x] #2 Cada linha mostra se o nick foi encontrado no Albion, não encontrado, ou se a consulta está indisponível
- [x] #3 Consulta ao Albion não bloqueia a tela nem a importação; resultado é cacheado
- [x] #4 Filtro por não encontrados e busca por nick ou usuário do Discord
- [x] #5 Sem permissão de admin, rota e API respondem 403
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
1. packages/shared/src/members-admin.ts: helpers puros (parseMemberFilter, normalizeMemberSearch+escapeLike, parseMemberPagination, describeAlbionCheck) + testes unitários.
2. packages/db/src/admin-members-repo.ts: listAdminMembers(db, query) com busca (nick ou usuário Discord), filtro (todos/não encontrados/sem nick), paginação, total e contagens por chip numa query só.
3. apps/server: AdminMembersController em admin/ (GET /api/admin/members read:UserRole; POST /api/admin/members/import update:UserRole + SameOriginGuard), token MEMBER_IMPORTER opcional ligado ao DiscordMemberImportService (BotModule global) com override por AppModuleOptions para teste; 403 do Discord vira mensagem PT-BR sobre o Server Members Intent (isMissingMembersIntent movido para domain/member-import.ts, reusado pelo comando).
4. apps/web: api/members.ts + pages/AdminMembers.tsx (tabela densa, chips de filtro, busca, botão primário de import com resumo em dialog), rota /admin/membros e item de nav em Gestão com read:UserRole.
5. Testes: unit dos helpers, HTTP (admin 200 + busca/filtro/paginação, staff/member 403, 401, import 200 com fake e 4xx com mensagem clara), e2e desktop+mobile.
6. Gate: pnpm quality com Postgres na 55460; screenshots 1280/400 nos dois temas via Playwright MCP; security-review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC → evidência
| AC | Evidência | Status |
|---|---|---|
| #1 lista com nick, tag, papéis, data de entrada | admin-members.http.test.ts "admin vê nick, tag de guilda, papéis, entrada e status do Albion" + e2e admin-members.spec.ts + admin-membros-1280-light.png | ✅ |
| #2 encontrado / não encontrado / indisponível | members-admin.test.ts "rótulo do status do Albion" (4 estados) + pílulas Encontrado / Não encontrado / Consulta indisponível / Não conferido visíveis em admin-membros-1280-light.png | ✅ |
| #3 Albion não bloqueia tela nem import; resultado cacheado | endpoint de listagem não injeta ALBION_PLAYER_LOOKUP e lê só as colunas persistidas pela TASK-042; e2e roda com ALBION_REGION vazia e a tela carrega inteira ("Não conferido"); import usa o lookup cacheado da TASK-016 e nunca lança | ✅ |
| #4 filtro por não encontrados + busca por nick ou usuário | admin-members.http.test.ts "busca acha por nick ou por usuário do Discord" e "filtra não encontrados e sem nick" + e2e "admin vê a lista, busca e filtra por sem nick" (desktop e mobile) + members-admin.test.ts | ✅ |
| #5 sem admin, rota e API 403 | admin-members.http.test.ts "sem sessão 401; member e staff 403 na lista e no import" + e2e "membro sem permissão não abre a tela nem a API" (403 no GET e no POST) | ✅ |

| DoD | Evidência | Status |
|---|---|---|
| #1 gate | ⚠️ Passou com avisos, sem item bloqueante (tabela acima) | ✅ |
| #2 AC com evidência objetiva | tabela acima, toda linha é teste, e2e ou screenshot | ✅ |
| #3 skills | emil-design-eng, revenue-centric-design, ask-sonner, security-review, task-done-check | ✅ |
| #4 e2e + screenshots 1280/400 revisados | e2e/admin-members.spec.ts (6 testes, desktop+mobile) + 8 screenshots revisados, 1 achado corrigido | ✅ |
| #5 doc-005 | Q13 (papéis e permissões seed em código: reuso de read/UserRole e manage/all, nada de papel novo) e Q14 (Albion é ajuda, nunca bloqueio: status é informativo, "Não conferido" não impede nada). Nada fora do escopo da task | ✅ |
| #6 security-review | sem achado (toca auth) | ✅ |
| #7 notas e final summary | estas notas | ✅ |
| #8 PR merged | pendente: PR aberto, aguardando review humano (por instrução, não fazer merge) | ⏳ |
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adiciona a lista de membros do admin: GET /api/admin/members (busca por nick ou usuário do Discord, filtro todos/não encontrados/sem nick, paginação com total e contagem por chip) e POST /api/admin/members/import, que completa a TASK-042 reusando o DiscordMemberImportService e traduz o 403 do Discord em instrução PT-BR sobre o Server Members Intent. A tela /admin/membros mostra tabela densa, chips de filtro, busca e o resumo do import em toast + diálogo. Ambos os endpoints são admin-only por CASL (read/UserRole na lista, manage/all no import). Verificado com 12 testes unitários dos helpers puros, 7 testes HTTP (admin 200 com busca/filtro/paginação, member e staff 403, 401 sem sessão, import com dublê e 502 com mensagem clara), 6 e2e em desktop e mobile, e screenshots 1280/400 nos temas escuro e claro revisados pelo agent; pnpm quality passou (coverage 91.65%, e2e 46/46) e o security-review sobre o diff não achou nada.
<!-- SECTION:FINAL_SUMMARY:END -->
