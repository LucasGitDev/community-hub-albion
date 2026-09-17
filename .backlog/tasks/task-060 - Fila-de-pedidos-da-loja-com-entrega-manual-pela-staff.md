---
id: TASK-060
title: Fila de pedidos da loja com entrega manual pela staff
status: To Do
assignee: []
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 17:08'
labels: []
milestone: m-6
dependencies:
  - TASK-059
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fecha o ciclo da F6: o pedido comprado vira uma fila que a staff trabalha, no molde da fila de saques que já existe (linha com status e carimbos, reserva sem ledger, lançamento na conclusão, FK única para o lançamento gerado).

Estados: pending -> claimed -> delivered, mais cancelled (comprador) e rejected (staff). Sem confirmação do comprador e sem disputa: a staff é confiável, e exigir clique do comprador encheria a fila de pedidos entregues e eternamente abertos (F6-21).

O claimed existe para a staff sinalizar "peguei este" antes de entrar no jogo — sem ele, dois membros da staff entregam o mesmo item e ninguém descobre. E ele volta para pending se a staff desistir, porque o membro não pode ficar preso a um staff que sumiu (F6-22).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O pedido percorre pending -> claimed -> delivered, com cancelled e rejected como terminais
- [ ] #2 Transição inválida é recusada pelo serviço e pelo banco, no mesmo padrão dos checks de withdrawals
- [ ] #3 A staff assume um pedido (claimed) e pode devolvê-lo à fila, voltando para pending
- [ ] #4 A entrega exige nota da staff dizendo onde e para quem foi entregue
- [ ] #5 A Buffunfa fica reservada em pending e só entra no ledger em delivered
- [ ] #6 O comprador cancela o próprio pedido enquanto estiver pending; depois de claimed, só a staff
- [ ] #7 Cancelar, rejeitar ou estornar devolve a Buffunfa e o estoque na mesma transação, nunca só um dos dois
- [ ] #8 A staff enxerga a fila de pedidos em um painel, no molde da fila de saques
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
