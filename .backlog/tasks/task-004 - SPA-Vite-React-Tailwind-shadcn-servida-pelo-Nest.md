---
id: TASK-004
title: SPA Vite + React + Tailwind + shadcn servida pelo Nest
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - frontend
  - backend
milestone: m-0
dependencies:
  - TASK-003
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel web (Q3) em apps/web servido como estático pelo mesmo processo Nest (doc-002). Skills aplicáveis (doc-003): frontend-design, emil-design-eng, pick-ui-library antes de adicionar libs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Build do web gera SPA com Tailwind e shadcn funcionando
- [ ] #2 Nest serve a SPA na raiz e rotas client-side não quebram em refresh
- [ ] #3 Rotas /api continuam respondendo pela API e não pela SPA
<!-- AC:END -->
