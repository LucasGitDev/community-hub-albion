---
id: TASK-028
title: Edição e confirmação de split com lançamento no ledger
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
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
