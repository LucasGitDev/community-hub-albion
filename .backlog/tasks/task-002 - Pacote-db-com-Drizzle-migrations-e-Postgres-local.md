---
id: TASK-002
title: 'Pacote db com Drizzle, migrations e Postgres local'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - db
  - infra
milestone: m-0
dependencies:
  - TASK-001
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Persistência base (doc-002): packages/db com Drizzle e migrations sobre Postgres (Q16), usada por todas as fases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migrations aplicam do zero num Postgres vazio e são idempotentes em reexecução
- [ ] #2 Server consegue conectar e executar consulta usando o pacote db
- [ ] #3 Existe comando para gerar e aplicar migrations a partir da raiz
<!-- AC:END -->
