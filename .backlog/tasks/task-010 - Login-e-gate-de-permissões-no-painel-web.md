---
id: TASK-010
title: Login e gate de permissões no painel web
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - frontend
  - auth
milestone: m-1
dependencies:
  - TASK-009
  - TASK-004
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Front usa as mesmas abilities CASL para mostrar/ocultar áreas (Q13). Skills (doc-003): emil-design-eng, revenue-centric-design (activation no primeiro login).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Usuário deslogado vê tela de login com Discord em PT-BR
- [ ] #2 Usuário logado vê apenas navegação permitida pelo seu papel
- [ ] #3 Rota sem permissão acessada direto mostra estado de acesso negado
- [ ] #4 security-review executado sem achados críticos
<!-- AC:END -->
