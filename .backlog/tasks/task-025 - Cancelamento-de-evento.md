---
id: TASK-025
title: Cancelamento de evento
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - events
  - bot
milestone: m-4
dependencies:
  - TASK-024
priority: medium
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cancelar antes de running marca inscrições; em running devolve pessoas, apaga canal e fecha sessões; cancelado não aceita split (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cancelar antes de running marca inscrições como canceladas
- [ ] #2 Cancelar em running devolve pessoas, apaga canal e fecha sessões no canal
- [ ] #3 Evento finished não pode ser cancelado
- [ ] #4 Membros veem o evento como cancelado no embed e painel
<!-- AC:END -->
