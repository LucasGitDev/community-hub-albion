---
id: TASK-024
title: Start e finish de evento com canal de voz
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 03:50'
labels:
  - events
  - bot
  - voice
milestone: m-4
dependencies:
  - TASK-022
  - TASK-019
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Start fecha inscrições, cria canal na categoria configurada e arrasta confirmados em Aguardando Evento (Q28, Q29); finish devolve e apaga canal. Mesmo serviço para comando, painel e embed (doc-002).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Start cria canal na categoria configurada e move só inscritos confirmados presentes em Aguardando Evento
- [ ] #2 Finish devolve pessoas para Aguardando Evento e apaga o canal
- [ ] #3 Horários de start e finish ficam registrados
- [ ] #4 Comando, botão e painel produzem o mesmo resultado
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
