---
id: TASK-067
title: Motivo de destino desabilitado só existe no title
status: To Do
assignee: []
created_date: '2026-09-17 17:40'
labels: []
milestone: m-12
dependencies: []
priority: low
type: enhancement
ordinal: 7070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No painel de eventos, o botão de mover alguém para uma role lotada fica `disabled` com o motivo no atributo `title`. Leitor de tela não anuncia e em toque não aparece — quem usa teclado ou celular vê um botão morto sem explicação.

Vale um padrão único para todos os destinos de role (`aria-describedby` ou tooltip de verdade), não um remendo só neste botão: mexer em um deixaria a linha inconsistente com os outros.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O motivo do destino indisponível é anunciado por leitor de tela
- [ ] #2 O motivo aparece em toque, sem depender de hover
- [ ] #3 O padrão vale para todos os destinos de role da linha, não só o lotado
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
