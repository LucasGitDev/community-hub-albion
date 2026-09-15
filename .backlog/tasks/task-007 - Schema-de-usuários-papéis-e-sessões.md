---
id: TASK-007
title: 'Schema de usuários, papéis e sessões'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - db
  - auth
milestone: m-1
dependencies:
  - TASK-002
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Base de dados para auth (Q13): usuários vinculados ao Discord, atribuição de papéis member/caller/staff/admin e sessões.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration cria estruturas de usuário (id Discord único), papéis atribuídos e sessão
- [ ] #2 Usuário pode ter mais de um papel
- [ ] #3 Testes cobrem unicidade do id Discord
- [ ] #4 security-review executado sem achados críticos
<!-- AC:END -->
