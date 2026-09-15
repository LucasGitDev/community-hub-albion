---
id: TASK-008
title: Login com Discord OAuth2 e checagem de membro da guild
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - auth
  - backend
milestone: m-1
dependencies:
  - TASK-007
  - TASK-003
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel para todos (Q3) exige login Discord OAuth2 e só aceita quem é membro do GUILD_ID (Q4). Sessão segura.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Usuário membro da guild conclui login e recebe sessão
- [ ] #2 Usuário que não é membro da guild é recusado com mensagem PT-BR
- [ ] #3 Logout invalida a sessão
- [ ] #4 Sessão usa cookie httpOnly, secure em produção, com proteção CSRF/state no OAuth
- [ ] #5 security-review executado sem achados críticos
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
