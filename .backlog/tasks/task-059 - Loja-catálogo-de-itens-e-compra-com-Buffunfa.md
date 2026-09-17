---
id: TASK-059
title: 'Loja: catálogo de itens e compra com Buffunfa'
status: To Do
assignee: []
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 17:08'
labels: []
milestone: m-6
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A loja em si: a staff cadastra itens, o membro compra com Buffunfa. O item é de texto livre (nome, descrição, preço, estoque opcional), não um catálogo tipado — categorias tipadas agora seriam adivinhação, e três meses de uso dizem quais existem de verdade (F6-17). Itens previstos pelo usuário: itens do jogo, ping/criação de evento, e itens beneficentes. Cargos e cosméticos do Discord seguem mapeados e não automatizados, decisão que vem da v1.

Esta task entrega o catálogo e a compra; a fila de entrega vem na seguinte. O ponto de parada é utilizável sozinho: a staff cadastra e a guilda vê os preços antes de qualquer entrega existir.

Capacidades shop:manage (publicar item, definir preço) e shop:fulfill (entregar pedido) ficam no bloco staff, provisórias, com os nomes já registrados para a F7 (F6-25).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A staff cadastra, edita e despublica itens com nome, descrição, preço em Buffunfa e estoque opcional
- [ ] #2 O membro vê o catálogo com os preços e o próprio saldo de Buffunfa
- [ ] #3 Item sem estoque aparece marcado como esgotado e não clicável, em vez de sumir do catálogo
- [ ] #4 A compra recusa quando o saldo é insuficiente ou o estoque acabou, revalidando dentro da transação
- [ ] #5 A compra reserva a Buffunfa e o estoque sem lançar no ledger, no mesmo desenho da reserva da fila de saques
- [ ] #6 As capacidades shop:manage e shop:fulfill existem e estão ligadas ao bloco staff
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
