---
id: TASK-020
title: Catálogo global de roles e templates de evento
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - events
  - db
  - backend
  - frontend
milestone: m-4
dependencies:
  - TASK-009
priority: high
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roles por template a partir de catálogo global (Q8); DB é fonte de verdade (doc-002). Skills (doc-003): emil-design-eng, prototype.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff cria/edita roles no catálogo global
- [ ] #2 Template define roles do catálogo com quantidade de vagas
- [ ] #3 Role em uso por template não pode ser apagada
- [ ] #4 Sem permissão, API retorna 403
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
