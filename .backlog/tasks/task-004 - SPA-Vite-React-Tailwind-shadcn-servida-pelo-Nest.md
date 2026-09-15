---
id: TASK-004
title: SPA Vite + React + Tailwind + shadcn servida pelo Nest
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - frontend
  - backend
milestone: m-0
dependencies:
  - TASK-003
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel web (Q3) em apps/web servido como estático pelo mesmo processo Nest (doc-002). Skills aplicáveis (doc-003): frontend-design, emil-design-eng, pick-ui-library antes de adicionar libs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Build do web gera SPA com Tailwind e shadcn funcionando
- [ ] #2 Nest serve a SPA na raiz e rotas client-side não quebram em refresh
- [ ] #3 Rotas /api continuam respondendo pela API e não pela SPA
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
