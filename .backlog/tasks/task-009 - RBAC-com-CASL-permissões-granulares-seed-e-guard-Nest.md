---
id: TASK-009
title: 'RBAC com CASL: permissões granulares seed e guard Nest'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - auth
  - backend
milestone: m-1
dependencies:
  - TASK-008
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Papéis com permissões granulares seed em código (Q13), abilities CASL em packages/shared (doc-002) aplicadas por guard na API.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Permissões de member, caller, staff e admin definidas em código em packages/shared
- [ ] #2 Endpoint protegido retorna 403 para usuário sem permissão e 401 sem sessão
- [ ] #3 Testes cobrem a matriz papel x permissão
- [ ] #4 security-review executado sem achados críticos
<!-- AC:END -->
