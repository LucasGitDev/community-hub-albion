---
id: TASK-017
title: Schema de voice sessions
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - db
  - voice
milestone: m-3
dependencies:
  - TASK-002
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tabela única de entrada/saída de voz (doc-002), base para presença em eventos e loot split.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration cria sessão com usuário, canal, início, fim opcional e último heartbeat
- [ ] #2 Consulta retorna sessões abertas por usuário
- [ ] #3 Um usuário não tem mais de uma sessão aberta simultânea
<!-- AC:END -->
