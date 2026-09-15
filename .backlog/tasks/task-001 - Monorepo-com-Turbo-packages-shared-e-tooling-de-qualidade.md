---
id: TASK-001
title: 'Monorepo com Turbo, packages shared e tooling de qualidade'
status: To Do
assignee: []
created_date: '2026-09-15 03:23'
labels:
  - infra
  - ci
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Base do monorepo albion-hub (Q2) conforme doc-002: apps/server, apps/web, packages/db, packages/shared, com lint, typecheck e test orquestrados via Turbo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Workspace contém apps/server, apps/web, packages/db e packages/shared
- [ ] #2 Comandos de lint, typecheck e test rodam em todos os pacotes a partir da raiz e passam
- [ ] #3 packages/shared é importável por server e web
<!-- AC:END -->
