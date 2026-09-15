---
id: TASK-011
title: Gestão de papéis por admin
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - backend
  - frontend
  - auth
milestone: m-1
dependencies:
  - TASK-010
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin precisa atribuir papéis (caller, staff, admin) a usuários na v1 (Q13). Skills (doc-003): emil-design-eng, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Admin lista usuários e concede/remove papéis pelo painel
- [ ] #2 Não-admin não consegue alterar papéis via API
- [ ] #3 Não é possível remover o último admin
- [ ] #4 security-review executado sem achados críticos
<!-- AC:END -->
