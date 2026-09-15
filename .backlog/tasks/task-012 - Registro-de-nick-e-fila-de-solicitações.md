---
id: TASK-012
title: Registro de nick e fila de solicitações
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
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

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
