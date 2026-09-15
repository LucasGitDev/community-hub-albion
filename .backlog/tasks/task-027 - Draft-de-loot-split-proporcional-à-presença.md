---
id: TASK-027
title: Draft de loot split proporcional à presença
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - economy
  - events
  - backend
milestone: m-5
dependencies:
  - TASK-026
  - TASK-024
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Draft de split proporcional ao tempo no canal do evento entre start e finish (Q5, Q6); presente não inscrito entra com 0% (Q7); N splits por evento (Q23).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Draft calcula % por tempo no canal do evento entre start e finish
- [ ] #2 Presente não inscrito aparece com 0%
- [ ] #3 Evento aceita múltiplos splits
- [ ] #4 Evento cancelado não aceita split
- [ ] #5 security-review executado sem achados críticos
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
