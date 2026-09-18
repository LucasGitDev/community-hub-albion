---
id: TASK-077
title: 'Timeline: contas e eventos'
status: To Do
assignee: []
created_date: '2026-09-18 03:22'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6910
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações de contas e de eventos. Decisões T1 a T14 no doc-005.

Contas: nick pedido, aprovado e recusado; papel concedido e removido; banimento e desbanimento; limpeza diária (quem saiu do servidor).
Eventos: criado, aberto, inscrições fechadas, iniciado, finalizado, cancelado, arquivado.

Inscrição **não** aparece uma a uma (T8): ao fechar as inscrições, sai um registro com a lista de todos que estavam inscritos, com role e posição.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cada operação de conta listada publica na timeline depois do commit, com ator e alvo
- [ ] #2 Cada transição do ciclo de evento publica na timeline
- [ ] #3 Inscrições individuais não publicam
- [ ] #4 Fechar as inscrições publica a lista completa de inscritos com role e posição
- [ ] #5 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
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
