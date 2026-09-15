---
id: TASK-009
title: 'RBAC com CASL: permissões granulares seed e guard Nest'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 06:14'
labels:
  - auth
  - backend
milestone: m-1
dependencies:
  - TASK-008
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Papéis com permissões granulares seed em código (Q13), abilities CASL em packages/shared (doc-002) aplicadas por guard na API.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Permissões de member, caller, staff e admin definidas em código em packages/shared
- [x] #2 Endpoint protegido retorna 403 para usuário sem permissão e 401 sem sessão
- [x] #3 Testes cobrem a matriz papel x permissão
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
1. Abilities CASL em packages/shared com matriz papel x permissão (Q13). 2. SessionService + AuthorizeGuard (401/403) + decorator @Authorize. 3. GET /api/roles protegido. 4. Testes matriz e HTTP.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (Postgres + imagem): lint 0, race 0, typecheck ok, coverage 98.31%, e2e 10/10, image ok, dup 0%, dead 0, vulns 0.
Evidências:
- AC#1: packages/shared/src/permissions.ts define member/caller/staff/admin (papéis somam; caller só em eventos próprios; staff saques/eventos/entrada; admin manage all).
- AC#2: auth.http.test 'RBAC na API': /api/roles sem sessão e token inválido 401; member 403 'Você não tem permissão para esta ação.'; admin 200.
- AC#3: permissions.test.ts cobre 22 regras x 4 papéis (88 casos) + sem papel + soma de papéis.
- AC#4: security-review (skill, revisão direta dos arquivos): nenhum achado High/Medium. Risco residual: checagem por dono é responsabilidade do handler (ability.can com asSubject) — revisar em eventos/saques.
Decisões: /api/auth/me agora usa o mesmo guard; GET /api/roles criado como rota protegida real (base da TASK-011).
Skills: security-review, task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
RBAC com CASL: permissões por papel em packages/shared e guard na API (401 sem sessão, 403 sem permissão). Verificado com matriz de 88 casos, testes HTTP com Postgres e security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
