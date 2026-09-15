---
id: TASK-030
title: 'Fluxo de saque: pedido, aprovação, rejeição e liquidação'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
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
