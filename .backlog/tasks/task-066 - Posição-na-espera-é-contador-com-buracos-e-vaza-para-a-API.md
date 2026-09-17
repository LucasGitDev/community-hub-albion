---
id: TASK-066
title: Posição na espera é contador com buracos e vaza para a API
status: To Do
assignee: []
created_date: '2026-09-17 17:40'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: bug
ordinal: 7060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado durante a TASK-063. `nextWaitlistPosition` calcula a próxima posição com `max(position)` sobre **todas** as inscrições do slot — inclusive as canceladas e as confirmadas, que têm `position 0`. Resultado: `position` vira um contador monotônico que nunca reaproveita número, então a fila real fica com buracos permanentes (sobra só o "3º" depois que o 1º e o 2º saíram).

A TASK-063 mascarou isso **no painel**, passando a exibir o índice na lista ordenada (1º, 2º). Mas o número cru continua saindo em `/api/events/:id/roster` e no card do membro ("Tank, 1º na espera"). Ou seja: hoje o painel e o que o membro vê podem discordar entre si, que é pior do que os dois estarem errados juntos.

A correção é na origem — a posição precisa refletir a fila real — e não em mais uma camada de exibição.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A posição devolvida pela API é a posição real na fila, sem buracos, depois de cancelamentos e promoções
- [ ] #2 O card do membro e o painel da staff mostram o mesmo número para a mesma pessoa
- [ ] #3 Teste cobre a sequência: três na espera, o primeiro sai, o segundo é promovido, os restantes renumeram
- [ ] #4 A renumeração não altera a ordem relativa de quem já estava esperando
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
