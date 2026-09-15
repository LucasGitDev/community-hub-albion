---
id: TASK-030
title: 'Fluxo de saque: pedido, aprovação, rejeição e liquidação'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - economy
  - backend
  - db
milestone: m-5
dependencies:
  - TASK-026
priority: high
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Saque só de prata (doc-002): mínimo configurável default 1M sem taxa (Q12); pending reserva saldo, approved debita, rejected libera (Q25); settled manual com settled_by + nota (Q11); saldo negativo bloqueia novo saque (Q24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pedido abaixo do mínimo ou acima do saldo disponível é recusado
- [ ] #2 Pending reduz saldo disponível sem lançar no ledger
- [ ] #3 Approved lança débito; rejected libera reserva
- [ ] #4 Settled exige settled_by e nota
- [ ] #5 Pedidos concorrentes não ultrapassam o saldo
- [ ] #6 security-review executado sem achados críticos
<!-- AC:END -->
