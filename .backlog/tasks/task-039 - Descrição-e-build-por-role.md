---
id: TASK-039
title: Descrição e build por role
status: To Do
assignee: []
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 14:20'
labels:
  - db
  - backend
  - frontend
dependencies: []
priority: low
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cada role do catálogo ganha descrição e, futuramente, uma página de build. Nesta task: campo de descrição editável e exibido onde a role aparece.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff edita descrição da role
- [ ] #2 Descrição aparece no painel (templates, roster, inscrição)
- [ ] #3 Descrição é opcional e não quebra roles existentes
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
