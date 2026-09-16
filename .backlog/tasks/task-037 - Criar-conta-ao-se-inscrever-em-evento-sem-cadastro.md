---
id: TASK-037
title: Criar conta ao se inscrever em evento sem cadastro
status: To Do
assignee: []
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 03:45'
labels:
  - bot
  - backend
dependencies: []
priority: high
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Jogador sem conta no painel que clica no botão de inscrição do evento deve ter a conta criada na hora, com a mesma lógica do /registrar (upsert pelo Discord, papel member, bootstrap admin). Hoje a inscrição é recusada pedindo /registrar. Nick continua opcional: inscrição não exige nick aprovado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clique no botão de inscrição de quem não tem conta cria a conta e conclui a inscrição
- [ ] #2 Resposta efêmera explica que a conta foi criada e sugere registrar o nick
- [ ] #3 Mesma lógica do /registrar reaproveitada (sem duplicar regra de papéis)
- [ ] #4 Membro que já tem conta segue sem mudança
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
