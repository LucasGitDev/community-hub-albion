---
id: TASK-003
title: Server NestJS com bot Necord e comando /ping
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - backend
  - bot
milestone: m-0
dependencies:
  - TASK-001
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Processo único (doc-002) começa com Nest + Necord conectando ao Discord single-guild (Q4, GUILD_ID em env). UI e respostas do bot em PT-BR (Q18).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bot fica online na guild configurada por GUILD_ID
- [ ] #2 /ping responde em PT-BR
- [ ] #3 API expõe endpoint de health que responde 200
- [ ] #4 Config inválida ou ausente (token, GUILD_ID) impede boot com erro claro
<!-- AC:END -->
