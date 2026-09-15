---
id: TASK-011
title: Gestão de papéis por admin
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
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
- [ ] #1 Admin lista usuários e concede/remove papéis pelo painel
- [ ] #2 Não-admin não consegue alterar papéis via API
- [ ] #3 Não é possível remover o último admin
- [ ] #4 security-review executado sem achados críticos
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
