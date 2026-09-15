---
id: TASK-021
title: Criação de evento e máquina de estados
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - events
  - backend
  - db
milestone: m-4
dependencies:
  - TASK-020
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Só caller cria evento (Q9); owner único transferível por staff (Q21); estados draft→open→closed→running→finished + cancelled (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Caller cria evento a partir de template e vira owner
- [ ] #2 Não-caller não cria evento
- [ ] #3 Transições inválidas são rejeitadas; testes cobrem todas as transições válidas
- [ ] #4 Staff transfere owner e o histórico é mantido
- [ ] #5 Inscrição fecha manualmente ou no horário configurado
<!-- AC:END -->
