---
id: TASK-006
title: 'CI no GitHub Actions: lint, typecheck, test e build da imagem'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - ci
  - infra
milestone: m-0
dependencies:
  - TASK-005
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repositório GitHub privado com Actions desde F0 (Q17), garantindo qualidade contínua.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 PRs e pushes na branch principal disparam lint, typecheck, test e build da imagem
- [ ] #2 Falha em qualquer etapa deixa o check vermelho
- [ ] #3 Pipeline verde na branch principal
<!-- AC:END -->
