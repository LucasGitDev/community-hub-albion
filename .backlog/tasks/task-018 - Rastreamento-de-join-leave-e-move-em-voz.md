---
id: TASK-018
title: 'Rastreamento de join, leave e move em voz'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - bot
  - voice
milestone: m-3
dependencies:
  - TASK-017
  - TASK-003
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Persistir sessões a partir de eventos de voz do Discord (doc-004 F3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Entrar em canal abre sessão
- [ ] #2 Sair fecha a sessão com horário de fim
- [ ] #3 Mover de canal fecha a sessão anterior e abre nova no canal destino
- [ ] #4 Testes cobrem join, leave e move
<!-- AC:END -->
