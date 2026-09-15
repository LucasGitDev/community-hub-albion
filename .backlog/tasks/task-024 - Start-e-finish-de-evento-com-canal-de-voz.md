---
id: TASK-024
title: Start e finish de evento com canal de voz
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - events
  - bot
  - voice
milestone: m-4
dependencies:
  - TASK-022
  - TASK-019
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Start fecha inscrições, cria canal na categoria configurada e arrasta confirmados em Aguardando Evento (Q28, Q29); finish devolve e apaga canal. Mesmo serviço para comando, painel e embed (doc-002).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Start cria canal na categoria configurada e move só inscritos confirmados presentes em Aguardando Evento
- [ ] #2 Finish devolve pessoas para Aguardando Evento e apaga o canal
- [ ] #3 Horários de start e finish ficam registrados
- [ ] #4 Comando, botão e painel produzem o mesmo resultado
<!-- AC:END -->
