---
id: TASK-005
title: Imagem Docker multi-stage e docker compose com Postgres
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-002
  - TASK-004
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deploy em VPS própria via docker compose (Q16): uma imagem com bot + API + SPA e Postgres. Critério de pronto da F0 (doc-004).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docker compose up sobe app e Postgres e o app aplica migrations ou falha de forma clara
- [ ] #2 Um único container responde health da API, serve a SPA e conecta o bot
- [ ] #3 Imagem final não contém dependências de dev nem código-fonte TS desnecessário
<!-- AC:END -->
