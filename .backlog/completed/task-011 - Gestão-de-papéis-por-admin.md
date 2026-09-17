---
id: TASK-011
title: Gestão de papéis por admin
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 06:14'
labels:
  - backend
  - frontend
  - auth
milestone: m-1
dependencies:
  - TASK-010
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin precisa atribuir papéis (caller, staff, admin) a usuários na v1 (Q13). Skills (doc-003): emil-design-eng, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admin lista usuários e concede/remove papéis pelo painel
- [x] #2 Não-admin não consegue alterar papéis via API
- [x] #3 Não é possível remover o último admin
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
1. Repo: listUsersWithRoles + revokeRoleGuarded (lock FOR UPDATE nas linhas admin). 2. API /api/admin/users (GET, PUT/DELETE roles) com @Authorize UserRole + SameOriginGuard. 3. Página /admin/papeis. 4. Testes HTTP + e2e.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (Postgres): lint 0, race 0, typecheck ok, coverage 90.84%, e2e 18/18, image ok, dup 0%, dead 0, vulns 0.
Evidências:
- AC#1: admin-users.http.test 'admin lista usuários e concede/remove caller' (granted_by = admin) + e2e 'admin concede e remove caller pelo painel' (desktop/mobile; usuário alvo passa a ver Eventos). Screenshots .playwright-mcp/t011-roles-1280.png e t011-roles-400.png (sem overflow).
- AC#2: sem sessão 401; member e staff 403 em GET/PUT/DELETE; papéis do alvo inalterados.
- AC#3: remoções concorrentes de dois admins: só uma passa (204), a outra 409/403, sobra 1 admin; remover o último admin → 409 'Não é possível remover o último admin.' (3 execuções seguidas sem flake). UI desabilita o botão do último admin.
- AC#4: revisão de segurança focada: rotas exigem update UserRole (só admin), SameOriginGuard em PUT/DELETE além de SameSite=Lax, uuid e papel validados (member não gerenciável), guarda do último admin em transação com FOR UPDATE. Sem achados High/Medium.
Extra (achado na verificação visual): barra inferior do mobile só cabia 2 itens de gestão e admin não chegava a Papéis/Membros/Splits; adicionada faixa 'Gestão' rolável no mobile.
Skills: emil-design-eng, ask-sonner (toasts), security-review (manual), task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admin gerencia caller/staff/admin pelo painel com API protegida por RBAC e same-origin, sem nunca remover o último admin (inclusive concorrência). Verificado com testes HTTP em Postgres, e2e e screenshots 1280/400.
<!-- SECTION:FINAL_SUMMARY:END -->
