---
id: TASK-014
title: Bot aplica apelido e cargo Membro na aprovação
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-013
  - TASK-003
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Aprovado, o bot muda apelido no Discord e dá cargo Membro (Q31); troca de nick só altera apelido após aprovação.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Após aprovação, apelido no Discord passa a ser o nick aprovado
- [ ] #2 Primeira aprovação concede o cargo Membro configurado
- [ ] #3 Falha de permissão no Discord é registrada e não desfaz a aprovação
- [ ] #4 Rejeição não altera apelido nem cargos
<!-- AC:END -->
