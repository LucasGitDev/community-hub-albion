---
id: TASK-012
title: Registro de nick e fila de solicitações
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
labels:
  - backend
  - db
  - frontend
milestone: m-2
dependencies:
  - TASK-009
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Entrada de membros = nick + aprovação staff (Q14). Membro registra nick no painel; troca de nick gera nova solicitação pendente mantendo acesso e nick atual (Q31).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Usuário logado envia nick e a solicitação fica pending
- [ ] #2 Só há uma solicitação pendente por usuário
- [ ] #3 Troca de nick por membro aprovado cria pendência sem remover acesso nem nick vigente
- [ ] #4 Tela de registro em PT-BR; skills doc-003 revenue-centric-design e emil-design-eng aplicadas
<!-- AC:END -->
