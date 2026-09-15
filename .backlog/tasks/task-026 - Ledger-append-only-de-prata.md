---
id: TASK-026
title: Ledger append-only de prata
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - economy
  - db
  - backend
milestone: m-5
dependencies:
  - TASK-009
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ledger único append-only (doc-002) em bigint de prata inteira (Q20); correção só por estorno; saldo pode ficar negativo (Q24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lançamentos não podem ser editados nem apagados (garantido no banco)
- [ ] #2 Estorno cria lançamento inverso vinculado ao original
- [ ] #3 Saldo calculado é exato para valores acima de 2^53
- [ ] #4 Saldo negativo é permitido
- [ ] #5 security-review executado sem achados críticos
<!-- AC:END -->
