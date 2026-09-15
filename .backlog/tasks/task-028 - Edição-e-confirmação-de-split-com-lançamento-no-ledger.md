---
id: TASK-028
title: Edição e confirmação de split com lançamento no ledger
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - economy
  - backend
milestone: m-5
dependencies:
  - TASK-027
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff edita %; confirmar bloqueado se ≠ 100% (Q22); sobra de arredondamento vai ao owner (Q21, Q23); confirma quem tem event:distribute ou owner. Split confirmado impede cancelar (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Confirmação com soma ≠ 100% é recusada
- [ ] #2 Confirmação lança créditos cuja soma é exatamente o valor do split, com sobra ao owner
- [ ] #3 Só event:distribute ou owner confirmam
- [ ] #4 Confirmação é idempotente (sem crédito duplo)
- [ ] #5 Evento com split confirmado não pode ser cancelado
- [ ] #6 security-review executado sem achados críticos
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
