---
id: TASK-044
title: Estado arquivado depois de finalizado
status: To Do
assignee: []
created_date: '2026-09-16 14:35'
labels:
  - backend
  - frontend
  - bot
dependencies: []
priority: high
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisão do usuário (2026-09-16): 'finished' encerra o jogo mas ainda permite editar dados do evento, taxa e loot splits; é preciso um estado final de fato, 'archived', que bloqueia edição. Ajusta a máquina de estados (TASK-021), painel (TASK-023), embed e comandos.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Máquina aceita finished → archived e recusa qualquer transição a partir de archived
- [ ] #2 Evento finished permite editar dados, taxa e splits; archived bloqueia edição com mensagem clara (409)
- [ ] #3 Painel e embed mostram os dois estados de forma distinta, com ação de arquivar para owner/staff
- [ ] #4 Arquivar exige que não haja split em rascunho pendente (regra registrada nas notas)
- [ ] #5 Testes cobrem transições novas e bloqueio de edição em archived
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
