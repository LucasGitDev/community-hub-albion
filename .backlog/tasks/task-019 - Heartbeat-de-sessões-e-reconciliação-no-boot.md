---
id: TASK-019
title: Heartbeat de sessões e reconciliação no boot
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - bot
  - voice
milestone: m-3
dependencies:
  - TASK-018
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tolerância a quedas (Q30): heartbeat 1 min; no boot fecha abertas no último heartbeat e reabre pelo estado atual de voz.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sessões abertas têm heartbeat atualizado a cada 1 minuto
- [ ] #2 No boot, sessões abertas são fechadas com fim igual ao último heartbeat
- [ ] #3 No boot, quem está em voz recebe sessão nova
- [ ] #4 Testes simulam queda e reinício
<!-- AC:END -->
