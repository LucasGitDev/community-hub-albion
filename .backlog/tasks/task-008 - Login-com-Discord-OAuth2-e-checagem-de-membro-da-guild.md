---
id: TASK-008
title: Login com Discord OAuth2 e checagem de membro da guild
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - auth
  - backend
milestone: m-1
dependencies:
  - TASK-007
  - TASK-003
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel para todos (Q3) exige login Discord OAuth2 e só aceita quem é membro do GUILD_ID (Q4). Sessão segura.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Usuário membro da guild conclui login e recebe sessão
- [ ] #2 Usuário que não é membro da guild é recusado com mensagem PT-BR
- [ ] #3 Logout invalida a sessão
- [ ] #4 Sessão usa cookie httpOnly, secure em produção, com proteção CSRF/state no OAuth
- [ ] #5 security-review executado sem achados críticos
<!-- AC:END -->
