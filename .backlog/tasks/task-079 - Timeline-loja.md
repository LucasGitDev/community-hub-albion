---
id: TASK-079
title: 'Timeline: loja'
status: To Do
assignee: []
created_date: '2026-09-18 03:22'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6930
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações da loja. Decisões T1 a T14 no doc-005.

Item criado, editado e despublicado; pedido reservado, pego, devolvido à fila, entregue, cancelado e recusado; estorno de pedido entregue.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cada operação de item publica na timeline depois do commit, com ator e preço
- [ ] #2 Cada transição de pedido publica na timeline, com comprador, item, valor e quem da staff agiu
- [ ] #3 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
